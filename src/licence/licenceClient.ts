// Talks to the key server and keeps the last signed answer on this PC.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { normaliseLicenceKey, verifySignedLicence, type Licence, type SignedLicence } from './licence.js';

export class LicenceServerError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'LicenceServerError';
  }
}

export interface LicenceAnswer {
  licence: Licence;
  signed: SignedLicence;
  contact: string;
}

interface ServerReply {
  ok?: boolean;
  code?: string;
  message?: string;
  contact?: string;
  payload?: string;
  signature?: string;
}

/**
 * One call to the key server. Apps Script answers a POST with a redirect to the
 * result, which fetch follows as a GET. A signed licence comes back even for an
 * ended or suspended key, so the app can say so; refusals throw.
 */
export async function callLicenceServer(
  serverUrl: string,
  publicKeyPem: string,
  body: { action: 'activate' | 'check'; key: string; pcId: string; pcName: string; version: string; idToken?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<LicenceAnswer> {
  if (!serverUrl) throw new LicenceServerError('This build of TenderAssist has no key server set.', 'no-server');
  let reply: ServerReply;
  try {
    const response = await fetchImpl(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    reply = await response.json() as ServerReply;
  } catch {
    throw new LicenceServerError('The key server could not be reached. Check the internet connection and try again.', 'offline');
  }
  if (!reply.ok || !reply.payload || !reply.signature) {
    throw new LicenceServerError([reply.message || 'The key server refused the key.', reply.contact].filter(Boolean).join(' '), reply.code ?? 'refused');
  }
  const signed = { payload: reply.payload, signature: reply.signature };
  const licence = verifySignedLicence(signed, publicKeyPem);
  if (!licence || licence.key !== body.key || licence.pcId !== body.pcId) {
    throw new LicenceServerError('The key server\'s answer could not be trusted. Try again later.', 'bad-signature');
  }
  return { licence, signed, contact: reply.contact ?? '' };
}

/** What stays on this PC between starts. Signed, so editing it only breaks it. */
export interface StoredLicence {
  key: string;
  signed: SignedLicence | null;
  contact: string;
  /** The latest time this PC has seen, to notice a clock turned back. */
  latestSeen: string | null;
}

export class LicenceStore {
  constructor(private readonly path: string) {}

  read(): StoredLicence | null {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<StoredLicence>;
      const key = typeof value.key === 'string' ? normaliseLicenceKey(value.key) : null;
      if (!key) return null;
      const signed = value.signed && typeof value.signed.payload === 'string' && typeof value.signed.signature === 'string' ? value.signed : null;
      return { key, signed, contact: typeof value.contact === 'string' ? value.contact : '', latestSeen: typeof value.latestSeen === 'string' ? value.latestSeen : null };
    } catch {
      return null;
    }
  }

  write(value: StoredLicence): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2));
    renameSync(temporary, this.path);
  }
}

/** The key the installer saved (licence-key.txt next to the database), if any. */
export function readInstallerKey(appDataDir: string): string | null {
  try { return normaliseLicenceKey(readFileSync(join(appDataDir, 'licence-key.txt'), 'utf8')); }
  catch { return null; }
}

export function forgetInstallerKey(appDataDir: string): void {
  try { unlinkSync(join(appDataDir, 'licence-key.txt')); } catch { /* already gone */ }
}

/**
 * A stable ID for this PC: a hash of Windows' MachineGuid (the Mac's hardware
 * UUID), so the raw ID never leaves the PC. Reinstalling the app keeps it;
 * reinstalling Windows makes a new one (the owner resets PCs in the sheet).
 */
export async function pcIdentity(): Promise<{ pcId: string; pcName: string }> {
  const raw = await machineId().catch(() => '') || `host:${hostname()}`;
  return { pcId: createHash('sha256').update(`tenderassist-pc:${raw}`).digest('hex').slice(0, 32), pcName: hostname() };
}

function machineId(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      execFile('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
        const guid = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/.exec(stdout ?? '')?.[1];
        if (error || !guid) reject(error ?? new Error('No MachineGuid')); else resolve(guid.toLowerCase());
      });
    } else if (process.platform === 'darwin') {
      execFile('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 10_000 }, (error, stdout) => {
        const uuid = /"IOPlatformUUID" = "([^"]+)"/.exec(stdout ?? '')?.[1];
        if (error || !uuid) reject(error ?? new Error('No IOPlatformUUID')); else resolve(uuid.toLowerCase());
      });
    } else {
      try { resolve(readFileSync('/etc/machine-id', 'utf8').trim()); } catch (error) { reject(error); }
    }
  });
}
