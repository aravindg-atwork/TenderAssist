import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';
import { RunConfigurationRepository } from '../../../src/persistence/repositories/runConfigurationRepository.js';
import { DEFAULT_RUN_DEFAULTS } from '../../../src/config/runConfiguration.js';

describe('RunConfigurationRepository', () => {
  let db: DatabaseSync;
  let repo: RunConfigurationRepository;
  let jobId: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new RunConfigurationRepository(db);
    jobId = new JobRepository(db).create().id;
  });

  it('lists the five most recent run dates for one portal, including interrupted runs', () => {
    const jobs = new JobRepository(db);
    const first = jobId;
    repo.saveForJob(first, { searchDate: '2026-09-20', portalId: 'tamil-nadu', productCategories: ['IT'], keywords: ['software'], excludedKeywords: [] });
    db.prepare("UPDATE jobs SET state = 'COMPLETE' WHERE id = ?").run(first);
    const second = jobs.create().id;
    repo.saveForJob(second, { searchDate: '2026-09-22', portalId: 'tamil-nadu', productCategories: ['IT'], keywords: ['software'], excludedKeywords: [] });
    db.prepare("UPDATE jobs SET state = 'COMPLETE' WHERE id = ?").run(second);
    const interrupted = jobs.create().id;
    repo.saveForJob(interrupted, { searchDate: '2026-09-21', portalId: 'tamil-nadu', productCategories: ['IT'], keywords: ['software'], excludedKeywords: [] });
    const other = jobs.create().id;
    repo.saveForJob(other, { searchDate: '2026-09-23', portalId: 'kerala', productCategories: ['IT'], keywords: ['software'], excludedKeywords: [] });
    db.prepare("UPDATE jobs SET state = 'COMPLETE' WHERE id = ?").run(other);
    expect(repo.listRecentRunDates('tamil-nadu')).toEqual(['2026-09-22', '2026-09-21', '2026-09-20']);
  });

  it('remembers the confirmed tender selection, including an empty one', () => {
    repo.saveForJob(jobId, { searchDate: '2026-09-20', portalId: 'tamil-nadu', productCategories: ['IT'], keywords: ['software'], excludedKeywords: [] });
    expect(repo.getSelection(jobId)).toBeNull();
    repo.saveSelection(jobId, ['t1', 't2', 't1']);
    expect(repo.getSelection(jobId)).toEqual(['t1', 't2']);
    repo.saveSelection(jobId, []);
    expect(repo.getSelection(jobId)).toEqual([]);
  });

  it('returns safe built-in defaults before the user saves anything', () => {
    expect(repo.getDefaults()).toEqual(DEFAULT_RUN_DEFAULTS);
    expect(repo.hasSavedDefaults()).toBe(false);
  });

  it('normalizes, de-duplicates, and persists future-run defaults', () => {
    repo.saveDefaults({
      productCategories: [' Computer- S/W ', 'computer- s/w', 'Information Technology'],
      keywords: ['Web Application', ' web   application ', 'Digitization'],
      excludedKeywords: ['AMC', 'amc'],
    });
    expect(repo.getDefaults()).toEqual({
      productCategories: ['Computer- S/W', 'Information Technology'],
      keywords: ['Web Application', 'Digitization'],
      excludedKeywords: ['AMC'],
    });
    expect(repo.hasSavedDefaults()).toBe(true);
  });

  it('snapshots a job configuration independently of later default changes', () => {
    repo.saveForJob(jobId, {
      searchDate: '2026-09-21',
      productCategories: ['Information Technology'],
      keywords: ['software development'],
      excludedKeywords: ['hardware'],
    });
    repo.saveDefaults({
      productCategories: ['Computer- S/W'],
      keywords: ['different'],
      excludedKeywords: [],
    });

    expect(repo.getForJob(jobId)).toEqual({
      searchDate: '2026-09-21',
      portalId: 'tamil-nadu',
      productCategories: ['Information Technology'],
      keywords: ['software development'],
      excludedKeywords: ['hardware'],
    });
  });
});
