import type { AuthJobUpdate } from '../orchestration/authJobRunner.js';

// A click in the portal while TenderAssist drives it (searching, opening a
// tender, saving files) can send the page somewhere the run does not expect,
// and the run then fails. So while the run works, the portal takes no clicks
// from the operator. Whenever the run needs the operator (sign-in, CAPTCHA,
// DSC, a keep-or-skip question, a signed-out portal, the choice of more
// dates) or the run is over, the portal is theirs again.

const WORKING_PHASES = new Set(['SEARCH', 'CLASSIFICATION', 'ACQUISITION', 'EXTRACTION']);
const NEEDS_SIGN_IN = new Set(['SESSION_EXPIRED', 'AUTH_REQUIRED']);

/** Whether the operator's clicks should be held back from the portal for this update. */
export function portalShouldLock(update: AuthJobUpdate | undefined): boolean {
  if (!update || update.outcome) return false;
  if (update.question || update.awaitingMoreDates) return false;
  if (NEEDS_SIGN_IN.has(update.jobState)) return false;
  return WORKING_PHASES.has(update.phase ?? '');
}

export interface PortalLockState {
  /** The portal takes no clicks from the operator right now. */
  locked: boolean;
  /** The run would lock it, but the operator chose to use the portal anyway. */
  overridden: boolean;
}

/** The lock the portal should have: the run's need, unless the operator took control. */
export function portalLockState(update: AuthJobUpdate | undefined, operatorTookControl: boolean): PortalLockState {
  const wanted = portalShouldLock(update);
  return { locked: wanted && !operatorTookControl, overridden: wanted && operatorTookControl };
}
