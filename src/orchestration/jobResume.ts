import type { JobRepository, JobState } from '../persistence/repositories/jobRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';

// How an interrupted job continues. Anything after the shortlist resumes on
// the same job so the operator never repeats search, screening, or their
// tender selection; earlier stages are cheap to redo and start over.

export type ResumePlan =
  | { kind: 'SELECT_TENDERS' }
  | { kind: 'COLLECT_DOCUMENTS'; selectedTenderIds: string[] }
  | { kind: 'START_OVER' };

export interface ResumeFacts {
  jobState: JobState;
  /** The confirmed selection, or null if the operator never confirmed one. */
  selection: string[] | null;
}

export function planResume(facts: ResumeFacts): ResumePlan {
  if (facts.selection) return { kind: 'COLLECT_DOCUMENTS', selectedTenderIds: facts.selection };
  if (facts.jobState === 'SHORTLISTED') return { kind: 'SELECT_TENDERS' };
  return { kind: 'START_OVER' };
}

export function describeResumePlan(plan: ResumePlan): string {
  switch (plan.kind) {
    case 'COLLECT_DOCUMENTS':
      return 'Continue collecting documents for the tenders you chose. Files already saved are kept; you may need to sign in again.';
    case 'SELECT_TENDERS':
      return 'Continue from the shortlist: sign in, then choose which tenders to download. Search and screening are not repeated.';
    case 'START_OVER':
      return 'Start this run again with the same date and relevance settings.';
  }
}

// States from which document collection can start directly.
const COLLECTION_READY: readonly JobState[] = ['SHORTLISTED', 'AUTHENTICATED', 'FAILED_RETRYABLE'];

/** Move an interrupted job to a state from which document collection can start again. */
export function prepareForDocumentCollection(jobs: JobRepository, jobMachine: JobStateMachine, jobId: string): void {
  const state = jobs.getById(jobId)?.state;
  if (!state) throw new Error(`Job not found: ${jobId}`);
  if (COLLECTION_READY.includes(state)) return;
  jobMachine.transition(jobId, 'FAILED_RETRYABLE', 'interrupted run resumed by the operator');
}
