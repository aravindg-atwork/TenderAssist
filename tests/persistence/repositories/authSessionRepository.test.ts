import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../../src/persistence/repositories/authSessionRepository.js';

describe('AuthSessionRepository', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let repo: AuthSessionRepository;
  let jobId: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    repo = new AuthSessionRepository(db);
    jobId = jobs.create().id;
  });

  it('creates an auth session in NOT_STARTED state, linked to the job', () => {
    const session = repo.create(jobId);
    expect(session.state).toBe('NOT_STARTED');
    expect(session.job_id).toBe(jobId);
    expect(session.cdp_target_id).toBeNull();
    expect(session.authenticated_at).toBeNull();
  });

  it('returns undefined for an unknown id', () => {
    expect(repo.getById('does-not-exist')).toBeUndefined();
  });

  it('getLatestForJob returns the most recently created session for that job', () => {
    repo.create(jobId);
    const second = repo.create(jobId);

    const latest = repo.getLatestForJob(jobId);
    expect(latest?.id).toBe(second.id);
  });

  it('getLatestForJob returns undefined when the job has no sessions', () => {
    const otherJobId = jobs.create().id;
    expect(repo.getLatestForJob(otherJobId)).toBeUndefined();
  });

  it('updateState changes state and bumps updated_at', async () => {
    const session = repo.create(jobId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    repo.updateState(session.id, 'AUTH_PENDING');

    const fetched = repo.getById(session.id)!;
    expect(fetched.state).toBe('AUTH_PENDING');
    expect(fetched.updated_at).not.toBe(session.updated_at);
  });

  it('setCdpTargetId persists the target id', () => {
    const session = repo.create(jobId);
    repo.setCdpTargetId(session.id, 'target-abc');

    expect(repo.getById(session.id)?.cdp_target_id).toBe('target-abc');
  });

  it('markAuthenticatedAt persists the timestamp', () => {
    const session = repo.create(jobId);
    repo.markAuthenticatedAt(session.id, '2026-09-17T10:00:00.000Z');

    expect(repo.getById(session.id)?.authenticated_at).toBe('2026-09-17T10:00:00.000Z');
  });

  it('rejects an auth session for a non-existent job (foreign key)', () => {
    expect(() => repo.create('no-such-job')).toThrow();
  });
});
