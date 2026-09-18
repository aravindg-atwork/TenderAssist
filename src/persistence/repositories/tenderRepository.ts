import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface TenderRow {
  id: string;
  job_id: string;
  tender_ref: string;
  tender_portal_id: string | null;
  title: string;
  organisation_chain: string | null;
  published_date: string | null;
  closing_date: string | null;
  opening_date: string | null;
  product_category: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTenderInput {
  jobId: string;
  tenderRef: string;
  tenderPortalId: string | null;
  title: string;
  organisationChain: string | null;
  publishedDate: string | null;
  closingDate: string | null;
  openingDate: string | null;
  productCategory: string;
}

export class TenderRepository {
  constructor(private db: DatabaseSync) {}

  upsert(input: CreateTenderInput): TenderRow {
    const existing = this.findByJobAndRef(input.jobId, input.tenderRef);
    if (existing) return existing;

    const now = new Date().toISOString();
    const row: TenderRow = {
      id: randomUUID(),
      job_id: input.jobId,
      tender_ref: input.tenderRef,
      tender_portal_id: input.tenderPortalId,
      title: input.title,
      organisation_chain: input.organisationChain,
      published_date: input.publishedDate,
      closing_date: input.closingDate,
      opening_date: input.openingDate,
      product_category: input.productCategory,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO tenders (id, job_id, tender_ref, tender_portal_id, title, organisation_chain, published_date, closing_date, opening_date, product_category, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.job_id,
        row.tender_ref,
        row.tender_portal_id,
        row.title,
        row.organisation_chain,
        row.published_date,
        row.closing_date,
        row.opening_date,
        row.product_category,
        row.created_at,
        row.updated_at
      );
    return row;
  }

  findByJobAndRef(jobId: string, tenderRef: string): TenderRow | undefined {
    return this.db
      .prepare('SELECT * FROM tenders WHERE job_id = ? AND tender_ref = ?')
      .get(jobId, tenderRef) as TenderRow | undefined;
  }

  listForJob(jobId: string): TenderRow[] {
    return this.db
      .prepare('SELECT * FROM tenders WHERE job_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(jobId) as unknown as TenderRow[];
  }
}
