import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DRIVE_SCOPE, driveFolderNameParts, driveFolderPath, GoogleDriveClient, idTokenEmail, parseGoogleClientFile, signInWithGoogle } from '../../src/publishing/googleDrive.js';

interface Item { id: string; name: string; mimeType: string; parents: string[]; content?: Buffer; md5Checksum?: string; trashed?: boolean }

/** A small stand-in for Google's Drive API: enough to check what TenderAssist sends. */
function fakeDrive(options: { busyFirst?: number; badGrant?: boolean } = {}) {
  const items = new Map<string, Item>([
    ['ROOT', { id: 'ROOT', name: 'Tenders', mimeType: 'application/vnd.google-apps.folder', parents: [] }],
    ['root', { id: 'root', name: 'My Drive', mimeType: 'application/vnd.google-apps.folder', parents: [] }],
  ]);
  const sessions = new Map<string, { id?: string; name?: string; parents?: string[] }>();
  let next = 1;
  let busy = options.busyFirst ?? 0;
  const calls: string[] = [];
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (url.hostname === 'oauth2.googleapis.com') {
      return options.badGrant ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'token', expires_in: 3600 });
    }
    if (busy > 0) { busy -= 1; return json({ error: { message: 'Backend Error' } }, 503); }
    if (url.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'fe1@example.com', displayName: 'Office' } });
    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (fileMatch && method === 'GET') {
      const item = items.get(decodeURIComponent(fileMatch[1]));
      return item ? json({ ...item, capabilities: { canAddChildren: true } }) : json({ error: { message: 'File not found' } }, 404);
    }
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1');
      const folderOnly = q.includes('mimeType');
      return json({ files: [...items.values()].filter((item) => item.parents.includes(parent!) && item.name === name && !item.trashed && (!folderOnly || item.mimeType.endsWith('folder'))) });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(String(init.body)) as Item;
      const id = `F${next++}`;
      items.set(id, { ...body, id });
      return json({ id });
    }
    const upload = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(url.pathname);
    if (upload) {
      const session = `https://upload.example/session/${next++}`;
      sessions.set(session, upload[1] ? { id: decodeURIComponent(upload[1]) } : JSON.parse(String(init.body)));
      return new Response(null, { status: 200, headers: { Location: session } });
    }
    if (url.hostname === 'upload.example' && method === 'PUT') {
      const pending = sessions.get(input)!;
      const content = Buffer.from(init.body as Buffer);
      const md5Checksum = createHash('md5').update(content).digest('hex');
      if (pending.id) Object.assign(items.get(pending.id)!, { content, md5Checksum });
      else { const id = `F${next++}`; items.set(id, { id, name: pending.name!, parents: pending.parents!, mimeType: 'application/octet-stream', content, md5Checksum }); }
      return json({});
    }
    return json({ error: { message: `unexpected ${method} ${url.pathname}` } }, 400);
  }) as unknown as typeof fetch;
  const pathOf = (item: Item): string => item.parents.length === 0 ? item.name : `${pathOf(items.get(item.parents[0])!)}/${item.name}`;
  const files = () => [...items.values()].filter((item) => !item.mimeType.endsWith('folder')).map((item) => `${pathOf(item)} = ${item.content?.toString()}`).sort();
  return { fetchImpl, files, calls, items };
}

describe('uploading to Google Drive', () => {
  it('turns the typed folder name into the folders to make in My Drive', () => {
    expect(driveFolderNameParts('  Tenders   2026-27 ')).toEqual(['Tenders 2026-27']);
    expect(driveFolderNameParts('Office / Tenders\\2026')).toEqual(['Office', 'Tenders', '2026']);
    expect(driveFolderNameParts('')).toEqual([]);
    expect(() => driveFolderNameParts('Office/../Tenders')).toThrow(/cannot be/);
  });

  it('makes the named folder in My Drive once, then finds it again; a binned folder counts as gone', async () => {
    const drive = fakeDrive();
    const client = new GoogleDriveClient({ clientId: 'id', clientSecret: 'secret' }, 'refresh', { fetch: drive.fetchImpl, retryDelaysMs: [] });
    const made = await client.ensurePath('root', driveFolderNameParts('Office/Tenders 2026-27'));
    expect(await client.ensurePath('root', ['Office', 'Tenders 2026-27'])).toBe(made);
    expect([...drive.items.values()].filter((item) => item.mimeType.endsWith('folder')).map((item) => item.name).sort())
      .toEqual(['My Drive', 'Office', 'Tenders', 'Tenders 2026-27']);
    drive.items.get(made)!.trashed = true;
    await expect(client.folder(made)).rejects.toMatchObject({ status: 404 });
  });

  it('copies a tender folder into the same layout, sends nothing twice, and replaces a changed file', async () => {
    const local = mkdtempSync(join(tmpdir(), 'tenderassist-gdrive-'));
    const tender = join(local, '06-10-2026_1_Website redesign');
    mkdirSync(join(tender, 'Documents'), { recursive: true });
    writeFileSync(join(tender, 'Eligibility.xlsx'), 'sheet v1');
    writeFileSync(join(tender, 'Documents', "Scope of work's.pdf"), 'pdf');
    const drive = fakeDrive({ busyFirst: 2 });
    const client = new GoogleDriveClient({ clientId: 'id', clientSecret: 'secret' }, 'refresh', { fetch: drive.fetchImpl, retryDelaysMs: [0, 0, 0] });

    expect(await client.folder('ROOT')).toEqual({ id: 'ROOT', name: 'Tenders' });
    const day = await client.ensurePath('ROOT', ['10-2026', '06-10-2026']);
    const first = await client.putFolder(await client.ensureFolder(day, '06-10-2026_1_Website redesign'), tender);
    expect(first).toEqual({ uploaded: 2, unchanged: 0 });
    expect(drive.files()).toEqual([
      "Tenders/10-2026/06-10-2026/06-10-2026_1_Website redesign/Documents/Scope of work's.pdf = pdf",
      'Tenders/10-2026/06-10-2026/06-10-2026_1_Website redesign/Eligibility.xlsx = sheet v1',
    ]);

    // Again: the same folders are found, unchanged files are not sent.
    const again = await client.putFolder(await client.ensureFolder(await client.ensurePath('ROOT', ['10-2026', '06-10-2026']), '06-10-2026_1_Website redesign'), tender);
    expect(again).toEqual({ uploaded: 0, unchanged: 2 });
    expect([...drive.items.values()].filter((item) => item.mimeType.endsWith('folder'))).toHaveLength(6); // with My Drive

    writeFileSync(join(tender, 'Eligibility.xlsx'), 'sheet v2');
    expect(await client.putFolder(await client.ensureFolder(day, '06-10-2026_1_Website redesign'), tender)).toEqual({ uploaded: 1, unchanged: 1 });
    expect(drive.files()).toContain('Tenders/10-2026/06-10-2026/06-10-2026_1_Website redesign/Eligibility.xlsx = sheet v2');
    expect(drive.files()).toHaveLength(2);
    rmSync(local, { recursive: true, force: true });
  });

  it('says plainly when the sign-in has expired, and when the folder is gone', async () => {
    const expired = new GoogleDriveClient({ clientId: 'id', clientSecret: 'secret' }, 'refresh', { fetch: fakeDrive({ badGrant: true }).fetchImpl, retryDelaysMs: [] });
    await expect(expired.account()).rejects.toThrow(/Sign in to Google again/);
    const client = new GoogleDriveClient({ clientId: 'id', clientSecret: 'secret' }, 'refresh', { fetch: fakeDrive().fetchImpl, retryDelaysMs: [] });
    await expect(client.folder('MISSING')).rejects.toThrow(/folder was not found/);
  });
});

describe('signing in to Google in the browser', () => {
  const idToken = `x.${Buffer.from(JSON.stringify({ email: 'office@example.com' })).toString('base64url')}.sig`;
  const fakeGoogle = (answer: Record<string, unknown>, posted: URLSearchParams[] = []) => (async (_url: string, init: RequestInit) => {
    posted.push(new URLSearchParams(String(init.body)));
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as unknown as typeof fetch;
  // The "browser": Google sends it back to TenderAssist with a code.
  const approve = (check: (auth: URL) => void = () => {}) => async (url: string) => {
    const auth = new URL(url);
    check(auth);
    const back = new URL(auth.searchParams.get('redirect_uri')!);
    back.searchParams.set('code', 'code-xyz');
    back.searchParams.set('state', auth.searchParams.get('state')!);
    setTimeout(() => { void fetch(back.toString()); }, 10);
  };

  it('one sign-in gives the licence its identity and Drive its refresh token', async () => {
    const posted: URLSearchParams[] = [];
    const result = await signInWithGoogle({ clientId: 'client-1', clientSecret: 'secret-1' }, approve((auth) => {
      expect(auth.searchParams.get('scope')).toBe(`openid email ${DRIVE_SCOPE}`);
      expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
      expect(auth.searchParams.get('access_type')).toBe('offline');
      expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    }), { fetch: fakeGoogle({ access_token: 'a', refresh_token: 'refresh-123', id_token: idToken, scope: `openid ${DRIVE_SCOPE} https://www.googleapis.com/auth/userinfo.email` }, posted), timeoutMs: 5_000 });
    expect(result).toEqual({ idToken, refreshToken: 'refresh-123', email: 'office@example.com' });
    expect(posted[0].get('code')).toBe('code-xyz');
    expect(posted[0].get('client_secret')).toBe('secret-1');
    expect(posted[0].get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it('refuses a sign-in where Drive was unticked', async () => {
    await expect(signInWithGoogle({ clientId: 'c', clientSecret: 's' }, approve(),
      { fetch: fakeGoogle({ access_token: 'a', refresh_token: 'r', id_token: idToken, scope: 'openid https://www.googleapis.com/auth/userinfo.email' }), timeoutMs: 5_000 }))
      .rejects.toThrow(/Google Drive was not allowed/);
    expect(idTokenEmail('not a token')).toBe('');
  });

  it('reports a cancelled sign-in plainly', async () => {
    await expect(signInWithGoogle({ clientId: 'c', clientSecret: 's' }, async (url) => {
      const back = new URL(new URL(url).searchParams.get('redirect_uri')!);
      back.searchParams.set('error', 'access_denied');
      setTimeout(() => { void fetch(back.toString()); }, 10);
    }, { timeoutMs: 5_000 })).rejects.toThrow(/cancelled/);
  });
});

describe('the app’s own Google sign-in credential', () => {
  it('is read from the file Google Cloud gives for a Desktop app', () => {
    expect(parseGoogleClientFile('{"installed":{"client_id":"abc.apps.googleusercontent.com","client_secret":"GOCSPX-x","redirect_uris":["http://localhost"]}}'))
      .toEqual({ clientId: 'abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-x' });
    expect(parseGoogleClientFile('{"installed":{"client_id":"abc"}}')).toBeNull();
    expect(parseGoogleClientFile('not json')).toBeNull();
  });
});

describe('the Drive layout matches the folders on this computer', () => {
  it('splits a Windows path into one Drive folder per level, never one long name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tenderassist-layout-'));
    const day = join(root, '10-2026', '07-10-2026');
    const tender = join(day, '07-10-2026_6_Hiring of Agency for IT Projects- Milestone basis');
    mkdirSync(join(tender, 'Documents'), { recursive: true });
    writeFileSync(join(tender, 'Documents', 'GeM bid.pdf'), 'pdf');
    writeFileSync(join(tender, 'Eligibility.xlsx'), 'sheet');
    writeFileSync(join(day, 'Approved-Tenders-07-10-2026.xlsx'), 'report');

    expect(driveFolderPath(root, tender)).toEqual(['10-2026', '07-10-2026', '07-10-2026_6_Hiring of Agency for IT Projects- Milestone basis']);
    expect(driveFolderPath(`${root}\\`, `${day}\\`)).toEqual(['10-2026', '07-10-2026']);
    expect(() => driveFolderPath(root, tmpdir())).toThrow(/outside/);

    const drive = fakeDrive();
    const client = new GoogleDriveClient({ clientId: 'id', clientSecret: 'secret' }, 'refresh', { fetch: drive.fetchImpl, retryDelaysMs: [] });
    const segments = driveFolderPath(root, tender);
    const dayId = await client.ensurePath('ROOT', segments.slice(0, -1));
    await client.putFolder(await client.ensureFolder(dayId, segments[segments.length - 1]), tender);
    await client.putFile(await client.ensurePath('ROOT', driveFolderPath(root, day)), join(day, 'Approved-Tenders-07-10-2026.xlsx'), 'Approved-Tenders-07-10-2026.xlsx');
    expect(drive.files()).toEqual([
      'Tenders/10-2026/07-10-2026/07-10-2026_6_Hiring of Agency for IT Projects- Milestone basis/Documents/GeM bid.pdf = pdf',
      'Tenders/10-2026/07-10-2026/07-10-2026_6_Hiring of Agency for IT Projects- Milestone basis/Eligibility.xlsx = sheet',
      'Tenders/10-2026/07-10-2026/Approved-Tenders-07-10-2026.xlsx = report',
    ]);
    // No folder name carries a slash of either kind.
    expect([...drive.items.values()].every((item) => !/[\\/]/.test(item.name))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});
