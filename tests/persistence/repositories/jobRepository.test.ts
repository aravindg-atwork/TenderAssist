import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';

describe('JobRepository', () => {
  let db: DatabaseSync;
  let repo: JobRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new JobRepository(db);
  });

  it('creates a job in SCHEDULED state and reads it back', () => {
    const created = repo.create();
    expect(created.state).toBe('SCHEDULED');

    const fetched = repo.getById(created.id);
    expect(fetched).toEqual(created);
  });

  it('returns undefined for an unknown id', () => {
    expect(repo.getById('does-not-exist')).toBeUndefined();
  });

  it('updates state and bumps updated_at', async () => {
    const job = repo.create();
    await new Promise((resolve) => setTimeout(resolve, 5));
    repo.updateState(job.id, 'AUTH_REQUIRED');

    const fetched = repo.getById(job.id)!;
    expect(fetched.state).toBe('AUTH_REQUIRED');
    expect(fetched.updated_at).not.toBe(job.updated_at);
  });

  it('findIncomplete returns the most recent non-terminal job', () => {
    repo.create();
    const second = repo.create();
    repo.updateState(second.id, 'AUTH_REQUIRED');

    const incomplete = repo.findIncomplete();
    expect(incomplete?.id).toBe(second.id);
  });

  it('findIncomplete returns undefined when every job is terminal', () => {
    const job = repo.create();
    repo.updateState(job.id, 'FAILED_MANUAL');

    expect(repo.findIncomplete()).toBeUndefined();
  });
});
