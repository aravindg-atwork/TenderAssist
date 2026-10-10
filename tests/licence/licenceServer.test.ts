import { describe, expect, it } from 'vitest';
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { normaliseLicenceKey } from '../../src/licence/licence.js';
import { LICENCE_PUBLIC_KEY, LICENCE_SERVER_URL } from '../../src/licence/licenceServer.js';

// The Apps Script runs in Google, not here; its rules are plain functions, so
// load the file and test them directly.
const root = process.cwd();
const server = (() => {
  const context: Record<string, unknown> = {};
  runInNewContext(readFileSync(join(root, 'licence-server', 'Code.gs'), 'utf8'), context);
  // The sheet hands the script Date objects of its own realm.
  context.SheetDate = runInNewContext('Date', context);
  return context as {
    SheetDate: DateConstructor;
    makeKey(bytes: number[]): string;
    normaliseKey(text: string): string;
    decide(row: unknown[] | null, request: { action: string; pcId: string; account?: string }, pcs: string[], now: Date): {
      ok: boolean; code: string; message: string; bindAccount?: string; addPc?: boolean; licence?: Record<string, unknown>;
    };
    pemFrom(text: string): string;
    KEY_HEADERS: string[];
  };
})();

const NOW = new Date(2026, 9, 10, 12, 0);

function row(values: Record<string, unknown>): unknown[] {
  const defaults: Record<string, unknown> = {
    Key: 'TA-7KQ4M-X9PRW-3HD2N-V8TCE', Customer: 'Acme', 'Google account': '', Plan: 'Trial', 'PCs allowed': 1,
    'Expires on': new server.SheetDate(2026, 9, 20), 'Grace days': 3, Status: 'Active',
  };
  return server.KEY_HEADERS.map((header) => (header in values ? values[header] : defaults[header] ?? ''));
}

describe('licence server rules', () => {
  it('makes keys the app accepts, from the unambiguous alphabet', () => {
    const key = server.makeKey(Array.from({ length: 20 }, (_, index) => index * 37 + 11));
    expect(key).toMatch(/^TA(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}){4}$/);
    expect(normaliseLicenceKey(key)).toBe(key);
    expect(server.normaliseKey(key.toLowerCase().replace(/-/g, ' '))).toBe(key);
  });

  it('binds an unclaimed key to the first Google account and PC', () => {
    const answer = server.decide(row({}), { action: 'activate', pcId: 'pc-1', account: 'ops@acme.in' }, [], NOW);
    expect(answer).toMatchObject({ ok: true, bindAccount: 'ops@acme.in', addPc: true });
    expect(answer.licence).toMatchObject({ account: 'ops@acme.in', pcId: 'pc-1', plan: 'Trial', pcsInUse: 1, status: 'Active' });
    // "Expires on" 20 Oct is the last working day: it ends at midnight after, grace 3 days later.
    expect(new Date(String(answer.licence!.endsAt)).getTime()).toBe(new Date(2026, 9, 21).getTime());
    expect(new Date(String(answer.licence!.graceUntil)).getTime()).toBe(new Date(2026, 9, 24).getTime());
  });

  it('keeps a key to its Google account', () => {
    const owned = row({ 'Google account': 'Ops@Acme.in' });
    expect(server.decide(owned, { action: 'activate', pcId: 'pc-1', account: 'ops@acme.in' }, [], NOW).ok).toBe(true);
    const other = server.decide(owned, { action: 'activate', pcId: 'pc-1', account: 'someone@gmail.com' }, [], NOW);
    expect(other).toMatchObject({ ok: false, code: 'other-account' });
    expect(other.message).toContain('O•••@Acme.in');
  });

  it('counts PCs against the number allowed; a known PC can activate again', () => {
    const one = row({ 'Google account': 'ops@acme.in' });
    expect(server.decide(one, { action: 'activate', pcId: 'pc-2', account: 'ops@acme.in' }, ['pc-1'], NOW)).toMatchObject({ ok: false, code: 'too-many-pcs' });
    expect(server.decide(one, { action: 'activate', pcId: 'pc-1', account: 'ops@acme.in' }, ['pc-1'], NOW)).toMatchObject({ ok: true });
    const two = row({ 'Google account': 'ops@acme.in', 'PCs allowed': 2 });
    expect(server.decide(two, { action: 'activate', pcId: 'pc-2', account: 'ops@acme.in' }, ['pc-1'], NOW).licence).toMatchObject({ pcsInUse: 2 });
  });

  it('refuses activation without a confirmed Google sign-in, or on an ended or suspended key', () => {
    expect(server.decide(row({}), { action: 'activate', pcId: 'pc-1', account: '' }, [], NOW).code).toBe('sign-in-failed');
    expect(server.decide(row({ Status: 'Suspended' }), { action: 'activate', pcId: 'pc-1', account: 'a@b.in' }, [], NOW).code).toBe('ended');
    expect(server.decide(row({ 'Expires on': new server.SheetDate(2026, 9, 1) }), { action: 'activate', pcId: 'pc-1', account: 'a@b.in' }, [], NOW).code).toBe('ended');
  });

  it('answers a check only for PCs on the key, and still signs an ended or suspended key so the app locks', () => {
    expect(server.decide(row({}), { action: 'check', pcId: 'pc-9' }, ['pc-1'], NOW).code).toBe('pc-not-activated');
    expect(server.decide(null, { action: 'check', pcId: 'pc-1' }, [], NOW).code).toBe('unknown-key');
    expect(server.decide(row({ Status: 'Suspended' }), { action: 'check', pcId: 'pc-1' }, ['pc-1'], NOW).licence).toMatchObject({ status: 'Suspended' });
  });

  it('uses 3 grace days when the cell is empty, and none when it says 0', () => {
    const empty = server.decide(row({ 'Grace days': '' }), { action: 'check', pcId: 'pc-1' }, ['pc-1'], NOW).licence!;
    expect(new Date(String(empty.graceUntil)).getTime()).toBe(new Date(2026, 9, 24).getTime());
    const none = server.decide(row({ 'Grace days': 0 }), { action: 'check', pcId: 'pc-1' }, ['pc-1'], NOW).licence!;
    expect(none.graceUntil).toBe(none.endsAt);
  });

  it('rebuilds the private key however it was pasted', () => {
    const pem = server.pemFrom('-----BEGIN PRIVATE KEY----- AAAA BBBB -----END PRIVATE KEY-----');
    expect(pem).toBe('-----BEGIN PRIVATE KEY-----\nAAAABBBB\n-----END PRIVATE KEY-----\n');
  });
});

describe('licence build settings', () => {
  it('has a usable public key', () => {
    expect(createPublicKey(LICENCE_PUBLIC_KEY).asymmetricKeyType).toBe('rsa');
  });

  it('gives the installer the same key server as the app', () => {
    const installer = /!define LICENCE_SERVER_URL "([^"]*)"/.exec(readFileSync(join(root, 'build', 'installer.nsh'), 'utf8'))?.[1];
    expect(installer).toBe(LICENCE_SERVER_URL);
  });
});
