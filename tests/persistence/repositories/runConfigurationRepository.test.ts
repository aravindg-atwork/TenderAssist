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

  it('returns safe built-in defaults before the user saves anything', () => {
    expect(repo.getDefaults()).toEqual(DEFAULT_RUN_DEFAULTS);
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
      productCategories: ['Information Technology'],
      keywords: ['software development'],
      excludedKeywords: ['hardware'],
    });
  });
});
