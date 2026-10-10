// TenderAssist runs on a licence key. A key belongs to one Google account and
// a set number of PCs; it has an end date, then grace days with a warning, then
// the app locks. The key server (licence-server/, a Google Sheet + Apps Script)
// signs each answer; the app keeps the last signed answer so it opens offline
// for OFFLINE_DAYS after the last check, never past the key's own dates.

import { verify } from 'node:crypto';

export const OFFLINE_DAYS = 3;
export const WARN_DAYS = 3;
/** How often an open app checks the key again. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Office PC clocks are often off by minutes or hours; only a clock a day behind the last check counts as turned back. */
const CLOCK_SLACK_MS = DAY_MS;
/** Same alphabet as the server: no 0/O or 1/I/L. */
const KEY_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{20}$/;

/** What the server signs. */
export interface Licence {
  v: 1;
  key: string;
  customer: string;
  account: string;
  pcId: string;
  plan: 'Trial' | 'Paid';
  status: 'Active' | 'Suspended' | 'Revoked';
  endsAt: string;
  graceUntil: string;
  pcsAllowed: number;
  pcsInUse: number;
  checkedAt: string;
}

export interface SignedLicence {
  payload: string;
  signature: string;
}

export type LicenceStanding =
  | 'not-activated'
  | 'active'
  | 'ending'
  | 'grace'
  | 'ended'
  | 'suspended'
  | 'offline-too-long'
  | 'clock-wrong';

export interface LicenceAssessment {
  standing: LicenceStanding;
  usable: boolean;
  /** Days the key still works counting today (1 = its last day is today; 0 or less once it has ended). */
  daysLeft: number | null;
  /** When the app locks if nothing changes: the end of grace, or the offline limit, whichever is first. */
  locksAt: string | null;
  message: string;
}

/** The key as typed or pasted, in its stored form, or null when it cannot be a key. */
export function normaliseLicenceKey(text: string): string | null {
  let plain = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (plain.startsWith('TA') && plain.length === 22) plain = plain.slice(2);
  if (!KEY_ALPHABET.test(plain)) return null;
  return `TA-${plain.slice(0, 5)}-${plain.slice(5, 10)}-${plain.slice(10, 15)}-${plain.slice(15, 20)}`;
}

/** The licence inside a server answer, if the signature is the server's and the payload is whole. */
export function verifySignedLicence(signed: SignedLicence, publicKeyPem: string): Licence | null {
  try {
    if (!verify('sha256', Buffer.from(signed.payload, 'utf8'), publicKeyPem, Buffer.from(signed.signature, 'base64'))) return null;
    const licence = JSON.parse(signed.payload) as Licence;
    const dates = [licence.endsAt, licence.graceUntil, licence.checkedAt].map((value) => Date.parse(value));
    if (licence.v !== 1 || !licence.key || !licence.pcId || dates.some((value) => Number.isNaN(value))) return null;
    return licence;
  } catch {
    return null;
  }
}

function dayText(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Where a licence stands at `now`. `latestSeen` is the latest time this PC has
 * seen (kept locally) so a clock turned back is noticed.
 */
export function assessLicence(licence: Licence | null, pcId: string, now: Date, latestSeen?: Date | null): LicenceAssessment {
  if (!licence || licence.pcId !== pcId) {
    return { standing: 'not-activated', usable: false, daysLeft: null, locksAt: null, message: 'Enter your TenderAssist key to start.' };
  }
  const time = now.getTime();
  const endsAt = Date.parse(licence.endsAt);
  const graceUntil = Date.parse(licence.graceUntil);
  const checkedAt = Date.parse(licence.checkedAt);
  const offlineUntil = checkedAt + OFFLINE_DAYS * DAY_MS;
  // Counted in calendar days on this PC, so the last day reads as "today", the day before as "tomorrow".
  const lastDay = new Date(endsAt - 1);
  const daysLeft = Math.round((Date.UTC(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS) + 1;
  const locksAt = new Date(Math.min(graceUntil, offlineUntil)).toISOString();

  if (licence.status === 'Suspended' || licence.status === 'Revoked') {
    return { standing: 'suspended', usable: false, daysLeft, locksAt: null, message: licence.status === 'Revoked' ? 'This key was withdrawn.' : 'This key is suspended.' };
  }
  const latest = Math.max(checkedAt, latestSeen?.getTime() ?? 0);
  if (time < latest - CLOCK_SLACK_MS) {
    return { standing: 'clock-wrong', usable: false, daysLeft, locksAt: null, message: "This PC's date and time are behind. Set them right, then check again." };
  }
  if (time >= graceUntil) {
    return { standing: 'ended', usable: false, daysLeft, locksAt: null, message: `Your key ended on ${dayText(new Date(endsAt - 1).toISOString())}.` };
  }
  if (time >= offlineUntil) {
    return { standing: 'offline-too-long', usable: false, daysLeft, locksAt: null, message: `TenderAssist could not check your key for ${plural(OFFLINE_DAYS, 'day')}. Connect to the internet and check again.` };
  }
  if (time >= endsAt) {
    return { standing: 'grace', usable: true, daysLeft, locksAt, message: `Your key ended on ${dayText(new Date(endsAt - 1).toISOString())}. TenderAssist locks on ${dayText(licence.graceUntil)} unless it is renewed.` };
  }
  if (daysLeft <= WARN_DAYS) {
    const what = licence.plan === 'Trial' ? 'Your trial' : 'Your key';
    const when = daysLeft <= 1 ? 'today' : daysLeft === 2 ? 'tomorrow' : `in ${plural(daysLeft - 1, 'day')}`;
    return { standing: 'ending', usable: true, daysLeft, locksAt, message: `${what} ends ${when}, on ${dayText(lastDay.toISOString())}.` };
  }
  return { standing: 'active', usable: true, daysLeft, locksAt, message: '' };
}
