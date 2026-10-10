import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LicenceStore } from '../../src/licence/licenceClient.js';
import { LicenceManager } from '../../src/licence/licenceManager.js';
import type { Licence } from '../../src/licence/licence.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEY = 'TA-7KQ4M-X9PRW-3HD2N-V8TCE';
const NOW = new Date('2026-10-10T06:00:00.000Z');

type Reply = Record<string, unknown>;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function signedReply(overrides: Partial<Licence> = {}, pcId = 'pc-1'): Reply {
  const licence: Licence = {
    v: 1, key: KEY, customer: 'Acme', account: 'ops@acme.in', pcId, plan: 'Paid', status: 'Active',
    endsAt: '2026-11-01T18:30:00.000Z', graceUntil: '2026-11-04T18:30:00.000Z', pcsAllowed: 2, pcsInUse: 1, checkedAt: NOW.toISOString(),
    ...overrides,
  };
  const payload = JSON.stringify(licence);
  return { ok: true, code: 'ok', message: '', contact: 'Contact: 98400 00000', payload, signature: sign('sha256', Buffer.from(payload), privateKey).toString('base64') };
}

function setup(replies: Array<Reply | Error>, options: { enforced?: boolean; now?: Date } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ta-licence-'));
  dirs.push(dir);
  const sent: Reply[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as Reply);
    const next = replies.shift();
    if (!next || next instanceof Error) throw next ?? new Error('no reply');
    return new Response(JSON.stringify(next), { status: 200 });
  }) as unknown as typeof fetch;
  let signIns = 0;
  const manager = new LicenceManager({
    store: new LicenceStore(join(dir, 'licence.json')),
    appDataDir: dir,
    serverUrl: 'https://script.google.com/macros/s/test/exec',
    publicKey: PUBLIC,
    version: '0.6.0',
    enforced: options.enforced ?? true,
    identity: async () => ({ pcId: 'pc-1', pcName: 'OFFICE-PC' }),
    signIn: async () => { signIns += 1; return 'id-token-1'; },
    fetch: fakeFetch,
    now: () => options.now ?? NOW,
  });
  return { manager, sent, dir, signIns: () => signIns };
}

describe('the app licence', () => {
  it('starts locked, offering the key the installer saved', async () => {
    const { manager, dir } = setup([]);
    writeFileSync(join(dir, 'licence-key.txt'), ' ta-7kq4m-x9prw-3hd2n-v8tce \r\n');
    const view = await manager.view();
    expect(view).toMatchObject({ enforced: true, usable: false, standing: 'not-activated', key: null, suggestedKey: KEY });
  });

  it('activates with a Google sign-in, keeps the signed answer, and forgets the installer key', async () => {
    const { manager, sent, dir, signIns } = setup([signedReply()]);
    writeFileSync(join(dir, 'licence-key.txt'), KEY);
    const view = await manager.activate('ta 7kq4m x9prw 3hd2n v8tce');
    expect(signIns()).toBe(1);
    expect(sent[0]).toMatchObject({ action: 'activate', key: KEY, pcId: 'pc-1', pcName: 'OFFICE-PC', version: '0.6.0', idToken: 'id-token-1' });
    expect(view).toMatchObject({ usable: true, standing: 'active', key: KEY, customer: 'Acme', account: 'ops@acme.in', pcsAllowed: 2, contact: 'Contact: 98400 00000' });
    expect(existsSync(join(dir, 'licence-key.txt'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'licence.json'), 'utf8')).key).toBe(KEY);
  });

  it('refuses text that is not a key before opening any sign-in', async () => {
    const { manager, signIns } = setup([]);
    await expect(manager.activate('hello')).rejects.toThrow(/not a TenderAssist key/);
    expect(signIns()).toBe(0);
  });

  it('shows the server\'s reason when it refuses activation', async () => {
    const { manager } = setup([{ ok: false, code: 'other-account', message: 'This key belongs to another Google account (o•••@acme.in).', contact: 'Contact: 98400 00000' }]);
    await expect(manager.activate(KEY)).rejects.toThrow(/another Google account.*Contact: 98400 00000/);
    expect((await manager.view()).usable).toBe(false);
  });

  it('does not trust an answer that is not signed by the server', async () => {
    const forged = { ...signedReply(), payload: JSON.stringify({ ...JSON.parse(String(signedReply().payload)), endsAt: '2030-01-01T00:00:00.000Z' }) };
    const { manager } = setup([forged]);
    await expect(manager.activate(KEY)).rejects.toThrow(/could not be trusted/);
  });

  it('picks up a changed end date (or a suspension) at the next check', async () => {
    const { manager, sent } = setup([signedReply(), signedReply({ endsAt: '2026-10-12T18:30:00.000Z', graceUntil: '2026-10-15T18:30:00.000Z' }), signedReply({ status: 'Suspended' })]);
    await manager.activate(KEY);
    const shortened = await manager.check();
    expect(sent[1]).toMatchObject({ action: 'check', key: KEY, pcId: 'pc-1' });
    expect(sent[1].idToken).toBeUndefined();
    expect(shortened).toMatchObject({ standing: 'ending', usable: true, daysLeft: 3 });
    expect(await manager.check()).toMatchObject({ standing: 'suspended', usable: false });
  });

  it('keeps working on the saved answer when the server cannot be reached', async () => {
    const { manager } = setup([signedReply(), new Error('offline')]);
    await manager.activate(KEY);
    const view = await manager.check();
    expect(view).toMatchObject({ usable: true, standing: 'active' });
    expect(view.lastProblem).toMatch(/could not be reached/);
  });

  it('asks to activate again when the owner reset this PC', async () => {
    const { manager } = setup([signedReply(), { ok: false, code: 'pc-not-activated', message: 'This PC is no longer on the key. Activate it again.' }]);
    await manager.activate(KEY);
    const view = await manager.check();
    expect(view).toMatchObject({ usable: false, standing: 'not-activated', key: KEY, suggestedKey: KEY });
    expect(view.lastProblem).toMatch(/Activate it again/);
  });

  it('lets a development copy work without a key', async () => {
    const { manager } = setup([], { enforced: false });
    expect(await manager.view()).toMatchObject({ enforced: false, usable: true, standing: 'not-activated' });
  });
});
