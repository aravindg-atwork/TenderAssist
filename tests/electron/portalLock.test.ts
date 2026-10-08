import { describe, expect, it } from 'vitest';
import { portalLockState, portalShouldLock } from '../../src/electron/portalLock.js';
import type { AuthJobUpdate } from '../../src/orchestration/authJobRunner.js';

const update = (extra: Partial<AuthJobUpdate>): AuthJobUpdate => ({
  jobId: 'j', authSessionId: 'a', jobState: 'SEARCHING', authState: 'AUTHENTICATED', ...extra,
} as AuthJobUpdate);

describe('portalShouldLock', () => {
  it('locks while the run searches, reads and saves files', () => {
    for (const phase of ['SEARCH', 'CLASSIFICATION', 'ACQUISITION', 'EXTRACTION'] as const) {
      expect(portalShouldLock(update({ phase }))).toBe(true);
    }
  });

  it('stays open for sign-in, CAPTCHA and DSC', () => {
    expect(portalShouldLock(update({ phase: 'AUTH', authStep: 'CAPTCHA_REQUIRED' }))).toBe(false);
    expect(portalShouldLock(update({ phase: 'AUTH', authStep: 'DSC_LAUNCHED' }))).toBe(false);
  });

  it('opens when the run needs the operator mid-run', () => {
    const question = { id: 'q' } as AuthJobUpdate['question'];
    expect(portalShouldLock(update({ phase: 'CLASSIFICATION', question }))).toBe(false);
    expect(portalShouldLock(update({ phase: 'ACQUISITION', jobState: 'SESSION_EXPIRED' }))).toBe(false);
    expect(portalShouldLock(update({ phase: 'PUBLISHING', awaitingMoreDates: true }))).toBe(false);
  });

  it('opens when the run is over, or there is no run', () => {
    expect(portalShouldLock(update({ phase: 'SEARCH', outcome: 'ABORTED' }))).toBe(false);
    expect(portalShouldLock(undefined)).toBe(false);
  });
});

describe('portalLockState', () => {
  it('lets the operator take control while the run would lock', () => {
    expect(portalLockState(update({ phase: 'SEARCH' }), false)).toEqual({ locked: true, overridden: false });
    expect(portalLockState(update({ phase: 'SEARCH' }), true)).toEqual({ locked: false, overridden: true });
  });

  it('has nothing to override when the run does not lock', () => {
    expect(portalLockState(update({ phase: 'AUTH' }), true)).toEqual({ locked: false, overridden: false });
  });
});
