// Uploads tender folders straight to a Google Drive folder through Google's
// Drive API, with no Google app on the computer. The operator signs in once
// in their browser; TenderAssist keeps the refresh token (encrypted by the
// caller) and uploads with it. See docs/google-drive-setup.md.

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
/** Full Drive access: the folder already exists, so the narrower "files this app made" scope cannot write into it. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 20_000];

export interface DriveCredentials {
  clientId: string;
  clientSecret: string;
}

export class GoogleDriveError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'GoogleDriveError';
  }
}

/**
 * The app's own Google sign-in credential, from the file Google Cloud gives
 * for a Desktop app ({"installed": {"client_id", "client_secret", …}}). It is
 * packed into the build; operators never see or type it.
 */
export function parseGoogleClientFile(text: string): DriveCredentials | null {
  try {
    const parsed = JSON.parse(text) as { installed?: Record<string, unknown>; web?: Record<string, unknown> } & Record<string, unknown>;
    const client = parsed.installed ?? parsed.web ?? parsed;
    const clientId = typeof client.client_id === 'string' ? client.client_id.trim() : '';
    const clientSecret = typeof client.client_secret === 'string' ? client.client_secret.trim() : '';
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  } catch {
    return null;
  }
}

/** The folder id from a Drive folder link (or the id itself). */
export function parseDriveFolderId(input: string): string | null {
  const value = input.trim();
  const fromLink = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(value)?.[1] ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(value)?.[1];
  if (fromLink) return fromLink;
  return /^[A-Za-z0-9_-]{10,}$/.test(value) ? value : null;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Drive names are matched with single quotes in queries; escape them and backslashes. */
function quoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Signs in with Google in the operator's own browser (the installed-app
 * loopback flow with PKCE) and returns a refresh token for Drive.
 */
export async function signInWithBrowser(
  credentials: DriveCredentials,
  openBrowser: (url: string) => Promise<void>,
  options: { fetch?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ refreshToken: string }> {
  const fetchImpl = options.fetch ?? fetch;
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(16));
  let server: Server | undefined;
  try {
    const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const error = url.searchParams.get('error');
        const received = url.searchParams.get('code');
        if (!error && !received) { response.writeHead(404).end(); return; }
        const ok = !error && received && url.searchParams.get('state') === state;
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
          `<!doctype html><meta charset="utf-8"><title>TenderAssist</title><body style="font-family:system-ui;padding:40px">
           <h2>${ok ? 'Signed in. You can close this tab and go back to TenderAssist.' : 'Google sign-in did not finish. Go back to TenderAssist and try again.'}</h2></body>`);
        if (ok) resolve({ code: received!, redirectUri });
        else reject(new GoogleDriveError(error === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${error ?? 'unexpected answer'}).`));
      });
      let redirectUri = '';
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = (server!.address() as { port: number }).port;
        redirectUri = `http://127.0.0.1:${port}`;
        const url = new URL(AUTH_URL);
        url.search = new URLSearchParams({
          client_id: credentials.clientId, redirect_uri: redirectUri, response_type: 'code', scope: DRIVE_SCOPE,
          code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state,
        }).toString();
        openBrowser(url.toString()).catch(reject);
      });
      const timer = setTimeout(() => reject(new GoogleDriveError('Google sign-in timed out. Try again, and finish it in the browser within 5 minutes.')), options.timeoutMs ?? 5 * 60_000);
      options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new GoogleDriveError('Google sign-in was stopped.')); }, { once: true });
    });
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: credentials.clientId, client_secret: credentials.clientSecret, redirect_uri: redirectUri,
        grant_type: 'authorization_code', code_verifier: verifier,
      }).toString(),
    });
    const body = await response.json().catch(() => ({})) as { refresh_token?: string; error_description?: string; error?: string };
    if (!response.ok || !body.refresh_token) {
      throw new GoogleDriveError(`Google did not complete the sign-in: ${body.error_description ?? body.error ?? `HTTP ${response.status}`}.`, response.status);
    }
    return { refreshToken: body.refresh_token };
  } finally {
    server?.close();
  }
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  md5Checksum?: string;
}

export interface UploadReport {
  uploaded: number;
  unchanged: number;
}

export class GoogleDriveClient {
  private readonly fetchImpl: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly delays: readonly number[];

  constructor(
    private readonly credentials: DriveCredentials,
    private readonly refreshToken: string,
    options: { fetch?: typeof fetch; retryDelaysMs?: readonly number[] } = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  /** The signed-in account, to show who TenderAssist uploads as. */
  async account(): Promise<{ email: string; name: string }> {
    const about = await this.json<{ user?: { emailAddress?: string; displayName?: string } }>(`${API}/about?fields=user(emailAddress,displayName)`);
    return { email: about.user?.emailAddress ?? '', name: about.user?.displayName ?? '' };
  }

  /** The target folder, checking it exists, is a folder, and can be written to. */
  async folder(folderId: string): Promise<{ id: string; name: string }> {
    const item = await this.json<DriveItem & { capabilities?: { canAddChildren?: boolean }; trashed?: boolean }>(
      `${API}/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`);
    if (item.mimeType !== FOLDER_TYPE || item.trashed) throw new GoogleDriveError('That Drive link is not a folder (or it is in the bin).');
    if (item.capabilities?.canAddChildren === false) throw new GoogleDriveError(`You can see “${item.name}” but cannot add files to it. Ask its owner for Editor access.`);
    return { id: item.id, name: item.name };
  }

  /** The child with this name in a folder, if there is one. */
  async child(parentId: string, name: string, folderOnly = false): Promise<DriveItem | null> {
    const q = [`${quoted(parentId)} in parents`, `name = ${quoted(name)}`, 'trashed = false', ...(folderOnly ? [`mimeType = '${FOLDER_TYPE}'`] : [])].join(' and ');
    const list = await this.json<{ files?: DriveItem[] }>(
      `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,md5Checksum)&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    return list.files?.[0] ?? null;
  }

  /** The folder with this name inside a folder, made if missing. */
  async ensureFolder(parentId: string, name: string): Promise<string> {
    const existing = await this.child(parentId, name, true);
    if (existing) return existing.id;
    const made = await this.json<DriveItem>(`${API}/files?fields=id&supportsAllDrives=true`, {
      method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER_TYPE, parents: [parentId] }), headers: { 'Content-Type': 'application/json' },
    });
    return made.id;
  }

  /** Makes each folder of a path under a folder, returning the last one. */
  async ensurePath(rootId: string, segments: readonly string[]): Promise<string> {
    let parent = rootId;
    for (const segment of segments) parent = await this.ensureFolder(parent, segment);
    return parent;
  }

  /** Uploads a file into a folder, replacing a different file of the same name; an identical one is left alone. */
  async putFile(parentId: string, localPath: string, name: string): Promise<'uploaded' | 'unchanged'> {
    const body = readFileSync(localPath);
    const md5 = createHash('md5').update(body).digest('hex');
    const existing = await this.child(parentId, name);
    if (existing?.md5Checksum === md5) return 'unchanged';
    const start = existing
      ? { url: `${UPLOAD_API}/files/${encodeURIComponent(existing.id)}?uploadType=resumable&supportsAllDrives=true`, method: 'PATCH', metadata: {} }
      : { url: `${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true`, method: 'POST', metadata: { name, parents: [parentId] } };
    const session = await this.request(start.url, {
      method: start.method, body: JSON.stringify(start.metadata),
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(body.length) },
    });
    const location = session.headers.get('location');
    if (!location) throw new GoogleDriveError('Google Drive did not start the upload.');
    await this.request(location, { method: 'PUT', body, headers: { 'Content-Length': String(body.length) } });
    return 'uploaded';
  }

  /** Uploads a local folder and everything in it into a Drive folder, same names, same layout. */
  async putFolder(parentId: string, localDirectory: string, report: UploadReport = { uploaded: 0, unchanged: 0 }): Promise<UploadReport> {
    for (const entry of readdirSync(localDirectory)) {
      const path = join(localDirectory, entry);
      if (statSync(path).isDirectory()) {
        await this.putFolder(await this.ensureFolder(parentId, entry), path, report);
      } else if (!/^~\$|\.tmp$|^desktop\.ini$|^thumbs\.db$/i.test(entry)) {
        report[await this.putFile(parentId, path, entry)] += 1;
      }
    }
    return report;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret,
        refresh_token: this.refreshToken, grant_type: 'refresh_token',
      }).toString(),
    });
    const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !body.access_token) {
      throw new GoogleDriveError(body.error === 'invalid_grant'
        ? 'The Google sign-in has expired or was removed. Sign in to Google again in Settings.'
        : `Google did not accept TenderAssist’s sign-in (${body.error ?? `HTTP ${response.status}`}).`, response.status);
    }
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async request(url: string, init: { method?: string; body?: string | Buffer; headers?: Record<string, string> } = {}): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(url, {
        method: init.method ?? 'GET',
        body: init.body as BodyInit | undefined,
        headers: { Authorization: `Bearer ${await this.accessToken()}`, ...init.headers },
      }).catch((error: unknown) => {
        if (attempt < this.delays.length) return null;
        throw new GoogleDriveError(`Google Drive could not be reached (${error instanceof Error ? error.message : String(error)}).`);
      });
      if (response && response.ok) return response;
      const status = response?.status ?? 0;
      // Busy, rate-limited or a dropped connection: wait and try again.
      if ((status === 0 || status === 429 || status >= 500 || status === 403 && await isRateLimit(response!)) && attempt < this.delays.length) {
        await pause(this.delays[attempt]);
        continue;
      }
      if (status === 401) this.token = null;
      const detail = response ? await response.json().then((body: { error?: { message?: string } }) => body.error?.message ?? '').catch(() => '') : '';
      if (/has not been used in project|is disabled/i.test(detail)) {
        throw new GoogleDriveError('The Google Drive API is switched off in the Google Cloud project. Open console.cloud.google.com → APIs & Services → Library → Google Drive API → Enable, wait a few minutes, then try again.', status);
      }
      throw new GoogleDriveError(status === 404
        ? 'The Drive folder was not found. Check the folder link, and that the signed-in account can open it.'
        : `Google Drive refused the request (HTTP ${status}${detail ? `: ${detail}` : ''}).`, status);
    }
  }

  private async json<T>(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<T> {
    return (await this.request(url, init)).json() as Promise<T>;
  }
}

async function isRateLimit(response: Response): Promise<boolean> {
  const body = await response.clone().json().catch(() => ({})) as { error?: { errors?: Array<{ reason?: string }> } };
  return Boolean(body.error?.errors?.some((error) => /rateLimit|userRateLimitExceeded/i.test(error.reason ?? '')));
}
