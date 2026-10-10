import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { assessLicence, normaliseLicenceKey, verifySignedLicence, type Licence } from '../../src/licence/licence.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const DAY = 24 * 60 * 60 * 1000;

function licence(overrides: Partial<Licence> = {}): Licence {
  return {
    v: 1, key: 'TA-AAAAA-BBBBB-CCCCC-DDDDD', customer: 'Acme', account: 'ops@acme.in', pcId: 'pc-1', plan: 'Paid', status: 'Active',
    endsAt: '2026-10-20T18:30:00.000Z', graceUntil: '2026-10-23T18:30:00.000Z', pcsAllowed: 1, pcsInUse: 1, checkedAt: '2026-10-10T06:00:00.000Z',
    ...overrides,
  };
}

function signed(value: Licence) {
  const payload = JSON.stringify(value);
  return { payload, signature: sign('sha256', Buffer.from(payload), privateKey).toString('base64') };
}

describe('licence keys', () => {
  it('accepts a key however it is typed or pasted', () => {
    expect(normaliseLicenceKey('ta-7kq4m-x9prw-3hd2n-v8tce')).toBe('TA-7KQ4M-X9PRW-3HD2N-V8TCE');
    expect(normaliseLicenceKey('  TA 7KQ4M X9PRW 3HD2N V8TCE\n')).toBe('TA-7KQ4M-X9PRW-3HD2N-V8TCE');
    expect(normaliseLicenceKey('7KQ4MX9PRW3HD2NV8TCE')).toBe('TA-7KQ4M-X9PRW-3HD2N-V8TCE');
  });

  it('refuses text that cannot be a key (wrong length, or letters keys never use)', () => {
    expect(normaliseLicenceKey('TA-7KQ4M-X9PRW-3HD2N')).toBeNull();
    expect(normaliseLicenceKey('TA-0KQ4M-X9PRW-3HD2N-V8TCE')).toBeNull();
    expect(normaliseLicenceKey('')).toBeNull();
  });
});

describe('signed licences', () => {
  it('trusts only answers signed by the server', () => {
    const answer = signed(licence());
    expect(verifySignedLicence(answer, PUBLIC)?.customer).toBe('Acme');
    const edited = { ...answer, payload: answer.payload.replace('2026-10-20', '2027-10-20') };
    expect(verifySignedLicence(edited, PUBLIC)).toBeNull();
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verifySignedLicence(answer, other)).toBeNull();
  });
});

describe('where a licence stands', () => {
  const checked = new Date('2026-10-10T06:00:00.000Z');

  it('needs a key when there is none, or it was made for another PC', () => {
    expect(assessLicence(null, 'pc-1', checked).standing).toBe('not-activated');
    expect(assessLicence(licence(), 'pc-2', checked).standing).toBe('not-activated');
  });

  it('works quietly while the key has days left', () => {
    const result = assessLicence(licence(), 'pc-1', checked);
    expect(result).toMatchObject({ standing: 'active', usable: true, daysLeft: 11 });
  });

  it('warns in the last days, then in grace days, then locks', () => {
    const value = licence({ checkedAt: '2026-10-19T06:00:00.000Z' });
    expect(assessLicence(value, 'pc-1', new Date('2026-10-19T08:00:00.000Z'))).toMatchObject({ standing: 'ending', usable: true, daysLeft: 2 });
    const grace = assessLicence(licence({ checkedAt: '2026-10-21T06:00:00.000Z' }), 'pc-1', new Date('2026-10-21T08:00:00.000Z'));
    expect(grace).toMatchObject({ standing: 'grace', usable: true });
    expect(grace.message).toMatch(/locks on/);
    expect(assessLicence(licence({ checkedAt: '2026-10-23T06:00:00.000Z' }), 'pc-1', new Date('2026-10-24T00:00:00.000Z'))).toMatchObject({ standing: 'ended', usable: false });
  });

  it('counts the last days in calendar days: today, tomorrow, in 2 days', () => {
    const value = licence({ checkedAt: '2026-10-18T06:00:00.000Z' });
    expect(assessLicence(value, 'pc-1', new Date('2026-10-20T08:00:00.000Z')).message).toMatch(/^Your key ends today/);
    expect(assessLicence(value, 'pc-1', new Date('2026-10-18T08:00:00.000Z')).message).toMatch(/^Your key ends in 2 days, on 20 Oct 2026/);
  });

  it('says "trial" for a trial', () => {
    const value = licence({ plan: 'Trial', checkedAt: '2026-10-19T06:00:00.000Z' });
    expect(assessLicence(value, 'pc-1', new Date('2026-10-19T08:00:00.000Z')).message).toMatch(/^Your trial ends tomorrow, on 20 Oct 2026/);
  });

  it('locks at once when the owner suspends or withdraws the key', () => {
    expect(assessLicence(licence({ status: 'Suspended' }), 'pc-1', checked)).toMatchObject({ standing: 'suspended', usable: false });
    expect(assessLicence(licence({ status: 'Revoked' }), 'pc-1', checked)).toMatchObject({ standing: 'suspended', usable: false });
  });

  it('works offline for three days after the last check, never longer', () => {
    expect(assessLicence(licence(), 'pc-1', new Date(checked.getTime() + 3 * DAY - 1)).usable).toBe(true);
    expect(assessLicence(licence(), 'pc-1', new Date(checked.getTime() + 3 * DAY))).toMatchObject({ standing: 'offline-too-long', usable: false });
  });

  it('notices a clock turned back by a day or more, but allows ordinary drift', () => {
    expect(assessLicence(licence(), 'pc-1', new Date(checked.getTime() - 2 * 60 * 60 * 1000)).usable).toBe(true);
    expect(assessLicence(licence(), 'pc-1', new Date(checked.getTime() - 2 * DAY)).standing).toBe('clock-wrong');
    const seenLater = new Date(checked.getTime() + 2 * DAY);
    expect(assessLicence(licence(), 'pc-1', new Date(checked.getTime() + 0.5 * DAY), seenLater).standing).toBe('clock-wrong');
  });
});
