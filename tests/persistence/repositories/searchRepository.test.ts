import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';
import { SearchRepository } from '../../../src/persistence/repositories/searchRepository.js';
import { CONFIGURED_SEARCHES } from '../../../src/search/searchConfig.js';

describe('CONFIGURED_SEARCHES', () => {
  it('has exactly 7 configured searches matching the real portal Product Category values', () => {
    expect(CONFIGURED_SEARCHES).toHaveLength(7);
    expect(CONFIGURED_SEARCHES.map((s) => s.productCategory)).toEqual([
      'Computer- H/W',
      'Computer- S/W',
      'Information Technology',
      'Info. Tech. Services',
      'Miscellaneous Goods',
      'Miscellaneous Services',
      'Miscellaneous Works',
    ]);
    expect(CONFIGURED_SEARCHES.map((s) => s.searchKey)).toEqual([
      'search_1',
      'search_2',
      'search_3',
      'search_4',
      'search_5',
      'search_6',
      'search_7',
    ]);
  });
});

describe('SearchRepository', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let repo: SearchRepository;
  let jobId: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    repo = new SearchRepository(db);
    jobId = jobs.create().id;
  });

  it('creates a search in PENDING state', () => {
    const search = repo.create(jobId, 'search_1', 'Computer- H/W');
    expect(search.state).toBe('PENDING');
    expect(search.current_page).toBe(0);
    expect(search.result_count).toBeNull();
  });

  it('findByJobAndKey returns the matching row', () => {
    repo.create(jobId, 'search_1', 'Computer- H/W');
    const found = repo.findByJobAndKey(jobId, 'search_1');
    expect(found?.product_category).toBe('Computer- H/W');
  });

  it('listForJob returns all searches for the job, ordered by search_key', () => {
    repo.create(jobId, 'search_3', 'Information Technology');
    repo.create(jobId, 'search_1', 'Computer- H/W');
    const list = repo.listForJob(jobId);
    expect(list.map((s) => s.search_key)).toEqual(['search_1', 'search_3']);
  });

  it('updateState and updateProgress persist changes', () => {
    const search = repo.create(jobId, 'search_1', 'Computer- H/W');
    repo.updateState(search.id, 'RUNNING');
    repo.updateProgress(search.id, 2, 15);

    const fetched = repo.getById(search.id)!;
    expect(fetched.state).toBe('RUNNING');
    expect(fetched.current_page).toBe(2);
    expect(fetched.result_count).toBe(15);
  });

  it('findFirstIncomplete returns the first non-COMPLETE search in search_key order', () => {
    const s1 = repo.create(jobId, 'search_1', 'Computer- H/W');
    const s2 = repo.create(jobId, 'search_2', 'Computer- S/W');
    repo.updateState(s1.id, 'COMPLETE');

    const incomplete = repo.findFirstIncomplete(jobId);
    expect(incomplete?.id).toBe(s2.id);
  });

  it('findFirstIncomplete returns undefined when every search is COMPLETE', () => {
    const s1 = repo.create(jobId, 'search_1', 'Computer- H/W');
    repo.updateState(s1.id, 'COMPLETE');

    expect(repo.findFirstIncomplete(jobId)).toBeUndefined();
  });
});
