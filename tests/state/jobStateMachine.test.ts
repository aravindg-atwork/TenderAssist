import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { JobStateMachine, IllegalJobTransitionError } from '../../src/state/jobStateMachine.js';

describe('JobStateMachine', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let transitions: StateTransitionRepository;
  let machine: JobStateMachine;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    transitions = new StateTransitionRepository(db);
    machine = new JobStateMachine(db, jobs, transitions);
  });

  it('allows a valid transition and records it in the audit log', () => {
    const job = jobs.create();
    machine.transition(job.id, 'AUTH_REQUIRED', 'scheduler fired');

    expect(jobs.getById(job.id)?.state).toBe('AUTH_REQUIRED');
    const log = transitions.listFor('JOB', job.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ from_state: 'SCHEDULED', to_state: 'AUTH_REQUIRED', reason: 'scheduler fired' });
  });

  it('rejects an invalid transition and leaves state unchanged', () => {
    const job = jobs.create();
    expect(() => machine.transition(job.id, 'COMPLETE')).toThrow(IllegalJobTransitionError);
    expect(jobs.getById(job.id)?.state).toBe('SCHEDULED');
    expect(transitions.listFor('JOB', job.id)).toHaveLength(0);
  });

  it('throws for an unknown job id', () => {
    expect(() => machine.transition('missing-job', 'AUTH_REQUIRED')).toThrow('Job not found: missing-job');
  });

  it('allows the full acquisition happy path in sequence', () => {
    const job = jobs.create();
    const path: Array<[string, string?]> = [
      ['AUTH_REQUIRED'],
      ['AUTH_PENDING'],
      ['AUTHENTICATED'],
      ['SEARCHING'],
      ['CLASSIFYING'],
      ['SHORTLISTED'],
      ['ACQUIRING_DOCUMENTS'],
      ['DOCUMENTS_LOCAL'],
      ['PROCESSING_DOCUMENTS'],
      ['EXTRACTING_REQUIREMENTS'],
      ['UPLOADING'],
      ['REPORTING'],
      ['COMPLETE'],
    ];
    for (const [to] of path) {
      expect(() => machine.transition(job.id, to as any)).not.toThrow();
    }
    expect(jobs.getById(job.id)?.state).toBe('COMPLETE');
  });

  it('allows SESSION_EXPIRED to loop back to AUTH_REQUIRED', () => {
    const job = jobs.create();
    machine.transition(job.id, 'AUTH_REQUIRED');
    machine.transition(job.id, 'AUTH_PENDING');
    machine.transition(job.id, 'AUTHENTICATED');
    machine.transition(job.id, 'SEARCHING');
    machine.transition(job.id, 'CLASSIFYING');
    machine.transition(job.id, 'SHORTLISTED');
    machine.transition(job.id, 'ACQUIRING_DOCUMENTS');
    machine.transition(job.id, 'SESSION_EXPIRED');
    machine.transition(job.id, 'AUTH_REQUIRED');

    expect(jobs.getById(job.id)?.state).toBe('AUTH_REQUIRED');
  });
});
