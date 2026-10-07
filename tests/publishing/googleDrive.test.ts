import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoogleDriveClient, parseDriveFolderId, parseGoogleClientFile, signInWithBrowser } from '../../src/publishing/googleDrive.js';

interface Item { id: string; name: string; mimeType: string; parents: string[]; content?: Buffer; md5Checksum?: string }

/** A small stand-in for Google's Drive API: enough to check what TenderAssist sends. */
function fakeDrive(options: { busyFirst?: number; badGrant?: boolean } = {}) {
  const items = new Map<string, Item>([['ROOT', { id: 'ROOT', name: 'Tenders', mimeType: 'application/vnd.google-apps.folder', parents: [] }]]);
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
      return json({ files: [...items.values()].filter((item) => item.parents.includes(parent!) && item.name === name && (!folderOnly || item.mimeType.endsWith('folder'))) });
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
  it('reads the folder id from a Drive link', () => {
    expect(parseDriveFolderId('https://drive.google.com/drive/folders/1ExsDTIIiwpEICyz8zGlwasUPgNBwODm2?usp=drive_link')).toBe('1ExsDTIIiwpEICyz8zGlwasUPgNBwODm2');
    expect(parseDriveFolderId('https://drive.google.com/open?id=1ExsDTIIiwpEICyz8zGlwasUPgNBwODm2')).toBe('1ExsDTIIiwpEICyz8zGlwasUPgNBwODm2');
    expect(parseDriveFolderId('not a link')).toBeNull();
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
    expect([...drive.items.values()].filter((item) => item.mimeType.endsWith('folder'))).toHaveLength(5);

    writeFileSync(join(tender, 'Eligibility.xlsx'), 'sheet v2');
    expect(await client.putFolder(await client.ensureFolder(day, '06-10-2026_1_Website redesign'), tender)).toEqual({ uploaded: 1, unchanged: 1 });
    expect(drive.files()).toContain('Tenders/10-2026/06-10-2026/06-10-2026_1_Website redesign/Eligibility.xlsx = sheet v2');
    expect(drive.files()).toHaveLength(2);
    rmSync(local, { recursive: true, force: true });
  });

  it('says plainly when the sign-in has expired, and when the folder link is wrong', async () => {
    const expired = new GoogleDriveClient({ clientId: 'id', clientSecret: 'secret' }, 'refresh', { fetch: fakeDrive({ badGrant: true }).fetchImpl, retryDelaysMs: [] });
    await expect(expired.account()).rejects.toThrow(/Sign in to Google again/);
    const client = new GoogleDriveClient({ clientId: 'id', clientSecret: 'secret' }, 'refresh', { fetch: fakeDrive().fetchImpl, retryDelaysMs: [] });
    await expect(client.folder('MISSING')).rejects.toThrow(/folder was not found/);
  });
});

describe('signing in to Google in the browser', () => {
  it('opens Google sign-in, receives the code on this computer, and keeps the refresh token', async () => {
    const posted: URLSearchParams[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      posted.push(new URLSearchParams(String(init.body)));
      return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'refresh-123' }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await signInWithBrowser({ clientId: 'client-1', clientSecret: 'secret-1' }, async (url) => {
      // The "browser": Google sends it back to TenderAssist with a code.
      const auth = new URL(url);
      expect(auth.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive');
      expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
      const back = new URL(auth.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', 'code-xyz');
      back.searchParams.set('state', auth.searchParams.get('state')!);
      setTimeout(() => { void fetch(back.toString()); }, 10);
    }, { fetch: fakeFetch, timeoutMs: 5_000 });
    expect(result).toEqual({ refreshToken: 'refresh-123' });
    expect(posted[0].get('code')).toBe('code-xyz');
    expect(posted[0].get('client_secret')).toBe('secret-1');
    expect(posted[0].get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it('reports a cancelled sign-in plainly', async () => {
    await expect(signInWithBrowser({ clientId: 'c', clientSecret: 's' }, async (url) => {
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
