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

  it('uses an explicit occurredAt when provided, instead of generating its own', () => {
    const explicitTimestamp = '2020-01-01T00:00:00.000Z';
    repo.record('JOB', 'job-1', null, 'SCHEDULED', 'created', explicitTimestamp);

    const rows = repo.listFor('JOB', 'job-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].occurred_at).toBe(explicitTimestamp);
  });

  it('auto-generates a timestamp when occurredAt is not provided', () => {
    const before = new Date().toISOString();
    repo.record('JOB', 'job-1', null, 'SCHEDULED');
    const after = new Date().toISOString();

    const rows = repo.listFor('JOB', 'job-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].occurred_at >= before).toBe(true);
    expect(rows[0].occurred_at <= after).toBe(true);
  });
});
