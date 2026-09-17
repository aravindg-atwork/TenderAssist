import type { DatabaseSync } from 'node:sqlite';
import type { JobRepository, JobState } from '../persistence/repositories/jobRepository.js';
import type { StateTransitionRepository } from '../persistence/repositories/stateTransitionRepository.js';
import { withTransaction } from '../persistence/db.js';

const VALID_TRANSITIONS: Record<JobState, JobState[]> = {
  SCHEDULED: ['AUTH_REQUIRED', 'FAILED_MANUAL'],
  AUTH_REQUIRED: ['AUTH_PENDING', 'FAILED_MANUAL'],
  AUTH_PENDING: ['AUTHENTICATED', 'AUTH_REQUIRED', 'FAILED_MANUAL'],
  AUTHENTICATED: ['SEARCHING', 'SESSION_EXPIRED', 'AUTH_REQUIRED', 'FAILED_MANUAL'],
  SEARCHING: ['CLASSIFYING', 'SESSION_EXPIRED', 'AUTH_REQUIRED', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  CLASSIFYING: ['SHORTLISTED', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  SHORTLISTED: ['ACQUIRING_DOCUMENTS', 'FAILED_MANUAL'],
  ACQUIRING_DOCUMENTS: [
    'DOCUMENTS_LOCAL',
    'SESSION_EXPIRED',
    'AUTH_REQUIRED',
    'FAILED_RETRYABLE',
    'FAILED_MANUAL',
  ],
  SESSION_EXPIRED: ['AUTH_REQUIRED', 'FAILED_MANUAL'],
  DOCUMENTS_LOCAL: ['PROCESSING_DOCUMENTS', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  PROCESSING_DOCUMENTS: ['EXTRACTING_REQUIREMENTS', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  EXTRACTING_REQUIREMENTS: ['UPLOADING', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  UPLOADING: ['REPORTING', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  REPORTING: ['COMPLETE', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  COMPLETE: [],
  FAILED_RETRYABLE: ['AUTH_REQUIRED', 'SEARCHING', 'ACQUIRING_DOCUMENTS', 'FAILED_MANUAL'],
  FAILED_MANUAL: [],
};

export class IllegalJobTransitionError extends Error {
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

    withTransaction(this.db, () => {
      this.jobs.updateState(jobId, to);
      this.transitions.record('JOB', jobId, job.state, to, reason);
    });
  }
}
