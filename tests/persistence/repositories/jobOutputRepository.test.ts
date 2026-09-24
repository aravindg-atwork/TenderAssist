import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobOutputRepository } from '../../../src/persistence/repositories/jobOutputRepository.js';
import { DEFAULT_OUTPUT_STRUCTURE } from '../../../src/publishing/outputStructure.js';

describe('JobOutputRepository', () => {
  let repo: JobOutputRepository;
  const root = 'C:\\TenderAssist';

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new JobOutputRepository(db);
  });

  it('numbers runs that share a day folder', () => {
    const first = repo.getOrCreatePlan('job-1', root, '2026-09-24', DEFAULT_OUTPUT_STRUCTURE);
    const second = repo.getOrCreatePlan('job-2', root, '2026-09-24', DEFAULT_OUTPUT_STRUCTURE);
    const otherDay = repo.getOrCreatePlan('job-3', root, '2026-09-25', DEFAULT_OUTPUT_STRUCTURE);
    expect(first.jobDirectory).toBe(second.jobDirectory);
    expect([first.runNumber, second.runNumber, otherDay.runNumber]).toEqual([1, 2, 1]);
  });

  it('treats differently cased roots as the same folder', () => {
    repo.getOrCreatePlan('job-1', root, '2026-09-24', DEFAULT_OUTPUT_STRUCTURE);
    expect(repo.getOrCreatePlan('job-2', root.toUpperCase(), '2026-09-24', DEFAULT_OUTPUT_STRUCTURE).runNumber).toBe(2);
  });

  it('freezes the first plan even when settings change later', () => {
    repo.getOrCreatePlan('job-1', root, '2026-09-24', DEFAULT_OUTPUT_STRUCTURE);
    const later = repo.getOrCreatePlan('job-1', 'D:\\Elsewhere', '2026-09-24', {
      ...DEFAULT_OUTPUT_STRUCTURE,
      dayFolderTemplate: '{YYYY}{MM}{DD}',
    });
    expect(later.outputRoot).toBe(root);
    expect(later.structure).toEqual(DEFAULT_OUTPUT_STRUCTURE);
    expect(later.jobDirectory).toBe(join(root, '09-2026', '24-09-2026'));
  });

  it('continues serial numbers across jobs in the same day folder and keeps them stable', () => {
    const first = repo.getOrCreatePlan('job-1', root, '2026-09-24', DEFAULT_OUTPUT_STRUCTURE);
    const second = repo.getOrCreatePlan('job-2', root, '2026-09-24', DEFAULT_OUTPUT_STRUCTURE);
    const otherDay = repo.getOrCreatePlan('job-3', root, '2026-09-25', DEFAULT_OUTPUT_STRUCTURE);
    expect(repo.serialNumberFor(first, 'a')).toBe(1);
    expect(repo.serialNumberFor(first, 'b')).toBe(2);
    expect(repo.serialNumberFor(second, 'c')).toBe(3);
    expect(repo.serialNumberFor(first, 'a')).toBe(1);
    expect(repo.serialNumberFor(otherDay, 'd')).toBe(1);
  });
});
