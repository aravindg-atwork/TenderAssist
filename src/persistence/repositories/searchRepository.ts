import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type SearchState = 'PENDING' | 'RUNNING' | 'PAGINATING' | 'COMPLETE' | 'INTERRUPTED';

export interface SearchRow {
  id: string;
  job_id: string;
  search_key: string;
  product_category: string;
  state: SearchState;
  current_page: number;
  result_count: number | null;
  created_at: string;
  updated_at: string;
}

export class SearchRepository {
  constructor(private db: DatabaseSync) {}

  create(jobId: string, searchKey: string, productCategory: string): SearchRow {
    const now = new Date().toISOString();
    const row: SearchRow = {
      id: randomUUID(),
      job_id: jobId,
      search_key: searchKey,
      product_category: productCategory,
      state: 'PENDING',
      current_page: 0,
      result_count: null,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO searches (id, job_id, search_key, product_category, state, current_page, result_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.job_id,
        row.search_key,
        row.product_category,
        row.state,
        row.current_page,
        row.result_count,
        row.created_at,
        row.updated_at
      );
    return row;
  }

  getById(id: string): SearchRow | undefined {
    return this.db.prepare('SELECT * FROM searches WHERE id = ?').get(id) as SearchRow | undefined;
  }

  findByJobAndKey(jobId: string, searchKey: string): SearchRow | undefined {
    return this.db
      .prepare('SELECT * FROM searches WHERE job_id = ? AND search_key = ?')
      .get(jobId, searchKey) as SearchRow | undefined;
  }

  listForJob(jobId: string): SearchRow[] {
    return this.db
      .prepare('SELECT * FROM searches WHERE job_id = ? ORDER BY search_key ASC')
      .all(jobId) as unknown as SearchRow[];
  }

  /** @internal Use through the search-execution orchestrator (Plan 6) once it exists. */
  updateState(id: string, state: SearchState): void {
    this.db
      .prepare('UPDATE searches SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, new Date().toISOString(), id);
  }

  updateProgress(id: string, currentPage: number, resultCount: number | null): void {
    this.db
      .prepare('UPDATE searches SET current_page = ?, result_count = ?, updated_at = ? WHERE id = ?')
      .run(currentPage, resultCount, new Date().toISOString(), id);
  }

  findFirstIncomplete(jobId: string): SearchRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM searches WHERE job_id = ? AND state NOT IN ('COMPLETE') ORDER BY search_key ASC LIMIT 1`
      )
      .get(jobId) as SearchRow | undefined;
  }
}
