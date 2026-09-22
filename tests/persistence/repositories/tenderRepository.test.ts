import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';
import { TenderRepository, type CreateTenderInput } from '../../../src/persistence/repositories/tenderRepository.js';

describe('TenderRepository', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let repo: TenderRepository;
  let jobId: string;

  const baseInput = (overrides: Partial<CreateTenderInput> = {}): CreateTenderInput => ({
    jobId,
    tenderRef: 'BU/R-D2/Software/12131',
    tenderPortalId: '2026_HE_703362_1',
    title: 'Software',
    organisationChain: 'Higher Education||Bharathiar University||Registrars office',
    publishedDate: '2026-09-10T17:00:00+05:30',
    closingDate: '2026-09-25T15:00:00+05:30',
    openingDate: '2026-09-28T16:00:00+05:30',
    productCategory: 'Computer- S/W',
    valueInRupees: 'NA',
    ...overrides,
  });

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    repo = new TenderRepository(db);
    jobId = jobs.create().id;
  });

  it('upsert creates a new tender row', () => {
    const tender = repo.upsert(baseInput());
    expect(tender.tender_ref).toBe('BU/R-D2/Software/12131');
    expect(tender.title).toBe('Software');
    expect(tender.product_category).toBe('Computer- S/W');
  });

  it('upsert is idempotent on (job_id, tender_ref) -- returns the existing row unchanged', () => {
    const first = repo.upsert(baseInput());
    const second = repo.upsert(baseInput({ title: 'A different title from a later search' }));

    expect(second.id).toBe(first.id);
    expect(second.title).toBe('Software');
  });

  it('findByJobAndRef returns the matching row', () => {
    repo.upsert(baseInput());
    const found = repo.findByJobAndRef(jobId, 'BU/R-D2/Software/12131');
    expect(found?.organisation_chain).toBe('Higher Education||Bharathiar University||Registrars office');
  });

  it('findByJobAndRef returns undefined for an unknown ref', () => {
    expect(repo.findByJobAndRef(jobId, 'no-such-ref')).toBeUndefined();
  });

  it('listForJob returns all tenders for the job in creation order', () => {
    repo.upsert(baseInput({ tenderRef: 'ref-1' }));
    repo.upsert(baseInput({ tenderRef: 'ref-2' }));
    const list = repo.listForJob(jobId);
    expect(list.map((t) => t.tender_ref)).toEqual(['ref-1', 'ref-2']);
  });

  it('upsert stores value_in_rupees and defaults favorited to false', () => {
    const tender = repo.upsert(baseInput({ valueInRupees: '1,50,000' }));
    expect(tender.value_in_rupees).toBe('1,50,000');
    expect(tender.favorited).toBe(0);
    expect(tender.favorited_at).toBeNull();
  });

  it('markFavorited sets favorited and favorited_at', () => {
    const tender = repo.upsert(baseInput());
    repo.markFavorited(tender.id, '2026-09-21T06:00:00.000Z');

    const fetched = repo.findByJobAndRef(jobId, tender.tender_ref)!;
    expect(fetched.favorited).toBe(1);
    expect(fetched.favorited_at).toBe('2026-09-21T06:00:00.000Z');
  });

  it('stores detail-page evidence separately from the search-result category', () => {
    const tender = repo.upsert(baseInput({ productCategory: 'Miscellaneous Services' }));
    repo.updateDetail(tender.id, {
      organisationChain: 'IT Department',
      publishedDate: '2026-09-21T10:00:00+05:30',
      productCategory: 'Information Technology',
      tenderCategory: 'Services',
      detailText: 'Development of a web application',
    });

    const fetched = repo.findByJobAndRef(jobId, tender.tender_ref)!;
    expect(fetched.product_category).toBe('Miscellaneous Services');
    expect(fetched.detail_product_category).toBe('Information Technology');
    expect(fetched.detail_reviewed_at).not.toBeNull();
  });
});
