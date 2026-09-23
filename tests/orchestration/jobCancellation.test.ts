import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../src/persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { SearchRepository } from '../../src/persistence/repositories/searchRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { ClassificationRepository } from '../../src/persistence/repositories/classificationRepository.js';
import { JobStateMachine } from '../../src/state/jobStateMachine.js';
import { runSearchPhase } from '../../src/orchestration/searchPhaseRunner.js';

describe('job cancellation', () => {
  it('ends before touching the portal and preserves a distinct CANCELLED state', async () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const jobs = new JobRepository(db);
    const sessions = new AuthSessionRepository(db);
    const transitions = new StateTransitionRepository(db);
    const jobMachine = new JobStateMachine(db, jobs, transitions);
    const searches = new SearchRepository(db);
    const tenders = new TenderRepository(db);
    const classifications = new ClassificationRepository(db);
    const job = jobs.create();
    jobMachine.transition(job.id, 'AUTH_REQUIRED');
    jobMachine.transition(job.id, 'AUTH_PENDING');
    jobMachine.transition(job.id, 'AUTHENTICATED');
    const session = sessions.create(job.id);
    const controller = new AbortController();
    controller.abort();

    const result = await runSearchPhase(
      { jobs, sessions, jobMachine, searches, tenders, classifications, signal: controller.signal },
      {} as Page,
      job.id,
      session.id,
      () => {}
    );

    expect(result.outcome).toBe('ABORTED');
    expect(result.abortReason).toContain('Stopped by user');
    expect(result.jobState).toBe('CANCELLED');
    expect(searches.listForJob(job.id)).toHaveLength(0);
  });
});
