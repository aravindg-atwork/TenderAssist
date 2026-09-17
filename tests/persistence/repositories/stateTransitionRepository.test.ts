import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { StateTransitionRepository } from '../../../src/persistence/repositories/stateTransitionRepository.js';

describe('StateTransitionRepository', () => {
  let db: DatabaseSync;
  let repo: StateTransitionRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new StateTransitionRepository(db);
  });

  it('records a transition and lists it back in order', () => {
    repo.record('JOB', 'job-1', null, 'SCHEDULED', 'created');
    repo.record('JOB', 'job-1', 'SCHEDULED', 'AUTH_REQUIRED');

    const rows = repo.listFor('JOB', 'job-1');
    expect(rows).toHaveLength(2);
    expect(rows[0].from_state).toBeNull();
    expect(rows[0].to_state).toBe('SCHEDULED');
    expect(rows[1].from_state).toBe('SCHEDULED');
    expect(rows[1].to_state).toBe('AUTH_REQUIRED');
  });

  it('scopes listFor to the given entity', () => {
    repo.record('JOB', 'job-1', null, 'SCHEDULED');
    repo.record('JOB', 'job-2', null, 'SCHEDULED');

    expect(repo.listFor('JOB', 'job-1')).toHaveLength(1);
  });
});
