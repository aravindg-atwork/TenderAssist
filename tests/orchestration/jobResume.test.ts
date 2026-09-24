import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository, type JobState } from '../../src/persistence/repositories/jobRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { JobStateMachine } from '../../src/state/jobStateMachine.js';
import { planResume, prepareForDocumentCollection } from '../../src/orchestration/jobResume.js';

describe('planResume', () => {
  it('collects documents when the operator already confirmed a selection', () => {
    expect(planResume({ jobState: 'ACQUIRING_DOCUMENTS', selection: ['t1'] }))
      .toEqual({ kind: 'COLLECT_DOCUMENTS', selectedTenderIds: ['t1'] });
    expect(planResume({ jobState: 'SESSION_EXPIRED', selection: ['t1'] }).kind).toBe('COLLECT_DOCUMENTS');
    expect(planResume({ jobState: 'REPORTING', selection: [] }).kind).toBe('COLLECT_DOCUMENTS');
  });

  it('reopens the tender selection when the run stopped at the shortlist', () => {
    expect(planResume({ jobState: 'SHORTLISTED', selection: null })).toEqual({ kind: 'SELECT_TENDERS' });
  });

  it('starts over when the run stopped before the shortlist', () => {
    expect(planResume({ jobState: 'SEARCHING', selection: null })).toEqual({ kind: 'START_OVER' });
    expect(planResume({ jobState: 'AUTH_PENDING', selection: null })).toEqual({ kind: 'START_OVER' });
  });

  it('starts over when no selection was saved and the job is past the shortlist', () => {
    expect(planResume({ jobState: 'SESSION_EXPIRED', selection: null })).toEqual({ kind: 'START_OVER' });
  });
});

describe('prepareForDocumentCollection', () => {
  const BEFORE_SHORTLIST: JobState[] = ['AUTH_REQUIRED', 'AUTH_PENDING', 'AUTHENTICATED', 'SEARCHING', 'CLASSIFYING', 'SHORTLISTED'];
  const PATHS: Record<string, JobState[]> = {
    SHORTLISTED: BEFORE_SHORTLIST,
    ACQUIRING_DOCUMENTS: [...BEFORE_SHORTLIST, 'ACQUIRING_DOCUMENTS'],
    SESSION_EXPIRED: [...BEFORE_SHORTLIST, 'ACQUIRING_DOCUMENTS', 'SESSION_EXPIRED'],
    AUTH_PENDING: [...BEFORE_SHORTLIST, 'ACQUIRING_DOCUMENTS', 'SESSION_EXPIRED', 'AUTH_REQUIRED', 'AUTH_PENDING'],
    UPLOADING: [...BEFORE_SHORTLIST, 'ACQUIRING_DOCUMENTS', 'DOCUMENTS_LOCAL', 'PROCESSING_DOCUMENTS', 'EXTRACTING_REQUIREMENTS', 'UPLOADING'],
  };

  for (const [stoppedAt, path] of Object.entries(PATHS)) {
    it(`lets a job interrupted in ${stoppedAt} start collecting documents again`, () => {
      const db = new DatabaseSync(':memory:');
      runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
      const jobs = new JobRepository(db);
      const machine = new JobStateMachine(db, jobs, new StateTransitionRepository(db));
      const job = jobs.create();
      for (const state of path) machine.transition(job.id, state);

      prepareForDocumentCollection(jobs, machine, job.id);
      expect(() => machine.transition(job.id, 'ACQUIRING_DOCUMENTS')).not.toThrow();
    });
  }
});
