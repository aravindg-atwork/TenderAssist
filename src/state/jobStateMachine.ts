import type { DatabaseSync } from 'node:sqlite';
import type { JobRepository, JobState } from '../persistence/repositories/jobRepository.js';
import type { StateTransitionRepository } from '../persistence/repositories/stateTransitionRepository.js';
import { withTransaction } from '../persistence/db.js';
import { IllegalTransitionError } from './errors.js';

const VALID_TRANSITIONS: Record<JobState, JobState[]> = {
  SCHEDULED: ['AUTH_REQUIRED', 'CANCELLED', 'FAILED_MANUAL'],
  AUTH_REQUIRED: ['AUTH_PENDING', 'FAILED_RETRYABLE', 'CANCELLED', 'FAILED_MANUAL'],
  AUTH_PENDING: ['AUTHENTICATED', 'AUTH_REQUIRED', 'FAILED_RETRYABLE', 'CANCELLED', 'FAILED_MANUAL'],
  // ACQUIRING_DOCUMENTS: resuming downloads after signing in again.
  AUTHENTICATED: ['SEARCHING', 'ACQUIRING_DOCUMENTS', 'SESSION_EXPIRED', 'AUTH_REQUIRED', 'CANCELLED', 'FAILED_MANUAL'],
  SEARCHING: ['CLASSIFYING', 'SESSION_EXPIRED', 'AUTH_REQUIRED', 'FAILED_RETRYABLE', 'CANCELLED', 'FAILED_MANUAL'],
  CLASSIFYING: ['SHORTLISTED', 'SESSION_EXPIRED', 'AUTH_REQUIRED', 'FAILED_RETRYABLE', 'CANCELLED', 'FAILED_MANUAL'],
  // AUTH_REQUIRED: signing in again before choosing tenders on a resumed run.
  SHORTLISTED: ['ACQUIRING_DOCUMENTS', 'AUTH_REQUIRED', 'SESSION_EXPIRED', 'CANCELLED', 'FAILED_MANUAL'],
  ACQUIRING_DOCUMENTS: [
    'DOCUMENTS_LOCAL',
    'SESSION_EXPIRED',
    'AUTH_REQUIRED',
    'FAILED_RETRYABLE',
    'CANCELLED',
    'FAILED_MANUAL',
  ],
  SESSION_EXPIRED: ['AUTH_REQUIRED', 'FAILED_RETRYABLE', 'CANCELLED', 'FAILED_MANUAL'],
  DOCUMENTS_LOCAL: ['PROCESSING_DOCUMENTS', 'FAILED_RETRYABLE', 'CANCELLED', 'FAILED_MANUAL'],
  PROCESSING_DOCUMENTS: ['EXTRACTING_REQUIREMENTS', 'FAILED_RETRYABLE', 'CANCELLED', 'FAILED_MANUAL'],
  EXTRACTING_REQUIREMENTS: ['UPLOADING', 'FAILED_RETRYABLE', 'CANCELLED', 'FAILED_MANUAL'],
  UPLOADING: ['REPORTING', 'FAILED_RETRYABLE', 'CANCELLED', 'FAILED_MANUAL'],
  REPORTING: ['COMPLETE', 'FAILED_RETRYABLE', 'CANCELLED', 'FAILED_MANUAL'],
  COMPLETE: [],
  FAILED_RETRYABLE: ['AUTH_REQUIRED', 'SEARCHING', 'ACQUIRING_DOCUMENTS', 'CANCELLED', 'FAILED_MANUAL'],
  CANCELLED: [],
  FAILED_MANUAL: [],
};

export class IllegalJobTransitionError extends IllegalTransitionError {
  constructor(from: JobState, to: JobState) {
    super(`Illegal job state transition: ${from} -> ${to}`);
    this.name = 'IllegalJobTransitionError';
  }
}

export class JobStateMachine {
  constructor(
    private db: DatabaseSync,
    private jobs: JobRepository,
    private transitions: StateTransitionRepository
  ) {}

  transition(jobId: string, to: JobState, reason?: string): void {
    const job = this.jobs.getById(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const allowed = VALID_TRANSITIONS[job.state] ?? [];
    if (!allowed.includes(to)) {
      throw new IllegalJobTransitionError(job.state, to);
    }

    const now = new Date().toISOString();
    withTransaction(this.db, () => {
      this.jobs.updateState(jobId, to);
      this.transitions.record('JOB', jobId, job.state, to, reason, now);
    });
  }
}
