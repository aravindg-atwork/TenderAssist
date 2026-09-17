import { IllegalJobTransitionError, type JobStateMachine } from '../state/jobStateMachine.js';
import type { SessionLossReason } from './browserController.js';
import { logger } from '../observability/logger.js';

export function reactToAuthSessionLoss(
  jobMachine: JobStateMachine,
  jobId: string
): (reason: SessionLossReason, terminalState: 'TAB_LOST' | 'SESSION_EXPIRED') => void {
  return (reason, terminalState) => {
    try {
      jobMachine.transition(jobId, 'AUTH_REQUIRED', `auth session lost: ${reason} (${terminalState})`);
    } catch (err) {
      if (!(err instanceof IllegalJobTransitionError)) throw err;
      // Job is already past the point where AUTH_REQUIRED is a valid
      // recovery target (e.g. already AUTH_REQUIRED, or a terminal
      // state) -- nothing to do.
      logger.debug('auth-session loss not applicable to job state', { jobId, reason, terminalState });
    }
  };
}
