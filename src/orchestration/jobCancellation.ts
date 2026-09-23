import type { JobRepository } from '../persistence/repositories/jobRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';

export const USER_CANCELLED_REASON = 'Stopped by user. Partial results have been kept.';

export function isCancellationRequested(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export function markJobCancelled(
  jobs: JobRepository,
  jobMachine: JobStateMachine,
  jobId: string
): void {
  const state = jobs.getById(jobId)?.state;
  if (!state || state === 'CANCELLED' || state === 'COMPLETE' || state === 'FAILED_MANUAL') return;
  jobMachine.transition(jobId, 'CANCELLED', 'user stopped the job');
}

export function throwIfCancellationRequested(signal?: AbortSignal): void {
  if (isCancellationRequested(signal)) throw new Error(USER_CANCELLED_REASON);
}
