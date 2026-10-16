import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobOutputRepository } from '../../../src/persistence/repositories/jobOutputRepository.js';
import { DEFAULT_OUTPUT_STRUCTURE } from '../../../src/publishing/outputStructure.js';

describe('JobOutputRepository', () => {
  let repo: JobOutputRepository;
  let db: DatabaseSync;
  const root = 'C:\\TenderAssist';

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
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
    expect(later.jobDirectory).toBe(join(root, 'September-2026', '24-09-2026'));
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

  it('gives a bid found again by a later run of the same date its earlier folder', () => {
    const tender = (id: string, jobId: string, ref: string, portalId = 'gem') => {
      db.prepare(`INSERT OR IGNORE INTO job_run_configs (job_id, search_date, product_categories_json, keywords_json, excluded_keywords_json, created_at, portal_id)
        VALUES (?, '2026-10-14', '[]', '[]', '[]', '', ?)`).run(jobId, portalId);
      db.prepare(`INSERT INTO tenders (id, job_id, tender_ref, tender_portal_id, title, organisation_chain, product_category, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'WhatsApp Chatbot', '', '', '', '')`).run(id, jobId, ref, ref);
    };
    db.prepare(`INSERT INTO jobs (id, state, created_at, updated_at) VALUES ('job-1', 'COMPLETE', '', ''), ('job-2', 'COMPLETE', '', ''), ('job-3', 'COMPLETE', '', '')`).run();
    tender('old', 'job-1', 'GEM/2026/B/1');
    tender('other', 'job-1', 'GEM/2026/B/2');
    tender('again', 'job-2', 'GEM/2026/B/1');
    tender('tn', 'job-3', 'GEM/2026/B/2', 'tamil-nadu');
    const first = repo.getOrCreatePlan('job-1', root, '2026-10-14', DEFAULT_OUTPUT_STRUCTURE);
    const second = repo.getOrCreatePlan('job-2', root, '2026-10-14', DEFAULT_OUTPUT_STRUCTURE);
    const third = repo.getOrCreatePlan('job-3', root, '2026-10-14', DEFAULT_OUTPUT_STRUCTURE);
    expect(repo.serialNumberFor(first, 'old')).toBe(1);
    expect(repo.serialNumberFor(first, 'other')).toBe(2);
    expect(repo.serialNumberFor(second, 'again')).toBe(1);
    expect(repo.findSerialNumber('old')).toBeUndefined();
    // Another website's tender never takes a folder, even with the same reference.
    expect(repo.serialNumberFor(third, 'tn')).toBe(3);
  });
});
