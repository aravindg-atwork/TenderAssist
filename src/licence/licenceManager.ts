// The app's side of the licence: activate with a key and a Google sign-in,
// check again in the background, and say whether work may start.

import { assessLicence, normaliseLicenceKey, verifySignedLicence, type Licence, type LicenceStanding } from './licence.js';
import { callLicenceServer, forgetInstallerKey, LicenceServerError, readInstallerKey, type LicenceStore } from './licenceClient.js';

/** What the renderer shows. */
export interface LicenceView {
  /** False in development builds: nothing is locked. */
  enforced: boolean;
  standing: LicenceStanding;
  usable: boolean;
  key: string | null;
  /** A key the installer saved, offered on the first screen. */
  suggestedKey: string | null;
  customer: string;
  account: string;
  plan: 'Trial' | 'Paid' | null;
  /** The last day the key works (ISO), and when grace ends. */
  lastDay: string | null;
  graceUntil: string | null;
  daysLeft: number | null;
  locksAt: string | null;
  pcsAllowed: number | null;
  pcsInUse: number | null;
  checkedAt: string | null;
  message: string;
  /** How to reach whoever gave the key (set in the sheet). */
  contact: string;
  /** Why the last check did not get through, if it did not. */
  lastProblem: string | null;
}

export interface LicenceManagerDeps {
  store: LicenceStore;
  appDataDir: string;
  serverUrl: string;
  publicKey: string;
  version: string;
  enforced: boolean;
  identity: () => Promise<{ pcId: string; pcName: string }>;
  /** Google sign-in in the browser; resolves with an ID token. */
  signIn: () => Promise<string>;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Answers that mean this PC no longer holds the key: forget the licence, keep the key to try again. */
const DROPS_LICENCE = new Set(['pc-not-activated', 'unknown-key']);

export class LicenceManager {
  private lastProblem: string | null = null;
  private identityPromise: Promise<{ pcId: string; pcName: string }> | null = null;
  private pcId = '';
  private readonly listeners = new Set<(view: LicenceView) => void>();

  constructor(private readonly deps: LicenceManagerDeps) {}

  private now(): Date { return this.deps.now?.() ?? new Date(); }

  private identity(): Promise<{ pcId: string; pcName: string }> {
    this.identityPromise ??= this.deps.identity().then((value) => { this.pcId = value.pcId; return value; });
    return this.identityPromise;
  }

  onChange(listener: (view: LicenceView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async changed(): Promise<LicenceView> {
    const view = await this.view();
    for (const listener of this.listeners) listener(view);
    return view;
  }

  private licence(): Licence | null {
    const stored = this.deps.store.read();
    return stored?.signed ? verifySignedLicence(stored.signed, this.deps.publicKey) : null;
  }

  async view(): Promise<LicenceView> {
    await this.identity();
    const stored = this.deps.store.read();
    const licence = this.licence();
    const latestSeen = stored?.latestSeen ? new Date(stored.latestSeen) : null;
    const assessment = assessLicence(licence, this.pcId, this.now(), latestSeen);
    const enforced = this.deps.enforced;
    return {
      enforced,
      standing: assessment.standing,
      usable: !enforced || assessment.usable,
      key: stored?.key ?? null,
      suggestedKey: stored?.key ?? readInstallerKey(this.deps.appDataDir),
      customer: licence?.customer ?? '',
      account: licence?.account ?? '',
      plan: licence?.plan ?? null,
      lastDay: licence ? new Date(Date.parse(licence.endsAt) - 1).toISOString() : null,
      graceUntil: licence?.graceUntil ?? null,
      daysLeft: assessment.daysLeft,
      locksAt: assessment.locksAt,
      pcsAllowed: licence?.pcsAllowed ?? null,
      pcsInUse: licence?.pcsInUse ?? null,
      checkedAt: licence?.checkedAt ?? null,
      message: assessment.message,
      contact: stored?.contact ?? '',
      lastProblem: this.lastProblem,
    };
  }

  /** Activates this PC with a key: Google sign-in, then the key server. */
  async activate(keyText: string): Promise<LicenceView> {
    const key = normaliseLicenceKey(keyText);
    if (!key) throw new Error('That is not a TenderAssist key. It looks like TA-XXXXX-XXXXX-XXXXX-XXXXX.');
    const { pcId, pcName } = await this.identity();
    const idToken = await this.deps.signIn();
    const previous = this.deps.store.read();
    try {
      const answer = await callLicenceServer(this.deps.serverUrl, this.deps.publicKey,
        { action: 'activate', key, pcId, pcName, version: this.deps.version, idToken }, this.deps.fetch);
      this.deps.store.write({ key, signed: answer.signed, contact: answer.contact, latestSeen: answer.licence.checkedAt });
      forgetInstallerKey(this.deps.appDataDir);
      this.lastProblem = null;
    } catch (error) {
      if (error instanceof LicenceServerError) {
        const contact = /Contact: (.+)$/.exec(error.message)?.[1];
        if (contact && previous) this.deps.store.write({ ...previous, contact: `Contact: ${contact}` });
      }
      throw error;
    }
    return this.changed();
  }

  /** Checks the key with the server. Never throws: a failed check is shown, and the saved licence keeps working until its offline limit. */
  async check(): Promise<LicenceView> {
    const stored = this.deps.store.read();
    if (!stored?.signed) return this.view();
    const { pcId, pcName } = await this.identity();
    try {
      const answer = await callLicenceServer(this.deps.serverUrl, this.deps.publicKey,
        { action: 'check', key: stored.key, pcId, pcName, version: this.deps.version }, this.deps.fetch);
      this.deps.store.write({ key: stored.key, signed: answer.signed, contact: answer.contact || stored.contact, latestSeen: answer.licence.checkedAt });
      this.lastProblem = null;
    } catch (error) {
      const code = error instanceof LicenceServerError ? error.code : 'offline';
      this.lastProblem = error instanceof Error ? error.message : String(error);
      if (DROPS_LICENCE.has(code)) this.deps.store.write({ ...stored, signed: null });
      else this.deps.store.write({ ...stored, latestSeen: this.latest(stored.latestSeen) });
    }
    return this.changed();
  }

  /** The later of now and the latest time seen, never going back. A good check resets it to the server's time. */
  private latest(previous: string | null | undefined): string {
    const now = this.now().getTime();
    const before = previous ? Date.parse(previous) : 0;
    return new Date(Math.max(now, Number.isNaN(before) ? 0 : before)).toISOString();
  }
}
