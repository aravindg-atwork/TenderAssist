import type { DatabaseSync } from 'node:sqlite';

/** Where a day's total came from. */
export type DailyCountSource = 'PUBLIC_LIST' | 'GEM_LIST';

export interface DailyPortalCount {
  portal_id: string;
  /** YYYY-MM-DD */
  published_date: string;
  total_published: number;
  /** Count per category across the whole website, when the website gives categories (GeM). */
  categories: Record<string, number> | null;
  source: DailyCountSource;
  read_at: string;
}

interface Row { portal_id: string; published_date: string; total_published: number; categories_json: string | null; source: DailyCountSource; read_at: string }

export class DailyCountRepository {
  constructor(private db: DatabaseSync) {}

  /**
   * Records a day's total. A public list shows only tenders still open, so a
   * later read can only be lower: the highest count seen is kept. A GeM day
   * list is complete, so it replaces the earlier one.
   */
  record(portalId: string, date: string, total: number, source: DailyCountSource, categories: Record<string, number> | null = null, at = new Date().toISOString()): void {
    const existing = this.get(portalId, date);
    if (existing && source === 'PUBLIC_LIST' && existing.total_published >= total) return;
    this.db.prepare(
      `INSERT INTO daily_portal_counts (portal_id, published_date, total_published, categories_json, source, read_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(portal_id, published_date) DO UPDATE SET total_published = excluded.total_published,
         categories_json = excluded.categories_json, source = excluded.source, read_at = excluded.read_at`
    ).run(portalId, date, total, categories ? JSON.stringify(categories) : null, source, at);
  }

  get(portalId: string, date: string): DailyPortalCount | undefined {
    const row = this.db.prepare('SELECT * FROM daily_portal_counts WHERE portal_id = ? AND published_date = ?').get(portalId, date) as Row | undefined;
    return row ? toCount(row) : undefined;
  }

  list(portalId: string, from: string, to: string): DailyPortalCount[] {
    return (this.db.prepare('SELECT * FROM daily_portal_counts WHERE portal_id = ? AND published_date BETWEEN ? AND ? ORDER BY published_date')
      .all(portalId, from, to) as unknown as Row[]).map(toCount);
  }

  /** When the website's totals were last read, for "Refresh" decisions. */
  lastReadAt(portalId: string): string | null {
    const row = this.db.prepare('SELECT MAX(read_at) AS at FROM daily_portal_counts WHERE portal_id = ?').get(portalId) as { at: string | null } | undefined;
    return row?.at ?? null;
  }
}

function toCount(row: Row): DailyPortalCount {
  let categories: Record<string, number> | null = null;
  try { categories = row.categories_json ? JSON.parse(row.categories_json) as Record<string, number> : null; } catch { categories = null; }
  return { portal_id: row.portal_id, published_date: row.published_date, total_published: row.total_published, categories, source: row.source, read_at: row.read_at };
}
