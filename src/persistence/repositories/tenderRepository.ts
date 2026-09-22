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
  value_in_rupees: string;
  favorited: 0 | 1;
  favorited_at: string | null;
  detail_product_category: string | null;
  tender_category: string | null;
  detail_text: string | null;
  detail_reviewed_at: string | null;
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
  valueInRupees: string;
}

export interface TenderDetailInput {
  organisationChain: string | null;
  publishedDate: string | null;
  productCategory: string | null;
  tenderCategory: string | null;
  detailText: string;
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
      value_in_rupees: input.valueInRupees,
      favorited: 0,
      favorited_at: null,
      detail_product_category: null,
      tender_category: null,
      detail_text: null,
      detail_reviewed_at: null,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO tenders (id, job_id, tender_ref, tender_portal_id, title, organisation_chain, published_date, closing_date, opening_date, product_category, value_in_rupees, favorited, favorited_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        row.value_in_rupees,
        row.favorited,
        row.favorited_at,
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

  markFavorited(id: string, favoritedAt: string): void {
    this.db
      .prepare('UPDATE tenders SET favorited = 1, favorited_at = ?, updated_at = ? WHERE id = ?')
      .run(favoritedAt, new Date().toISOString(), id);
  }

  updateDetail(id: string, input: TenderDetailInput): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE tenders SET
           organisation_chain = COALESCE(?, organisation_chain),
           published_date = ?,
           detail_product_category = ?,
           tender_category = ?,
           detail_text = ?,
           detail_reviewed_at = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.organisationChain,
        input.publishedDate,
        input.productCategory,
        input.tenderCategory,
        input.detailText,
        now,
        now,
        id
      );
  }

  deleteForJob(jobId: string): void {
    this.db.prepare('DELETE FROM tenders WHERE job_id = ?').run(jobId);
  }
}
