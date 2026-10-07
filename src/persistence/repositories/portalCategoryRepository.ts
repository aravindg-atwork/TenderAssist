import type { DatabaseSync } from 'node:sqlite';

/** The Product Category list as the website itself shows it, read during a search. */
export interface PortalCategoryList {
  categories: string[];
  /** When a search last read the list; null before the first search. */
  readAt: string | null;
  /** The website's own code for each category, by name, where it has one (GeM). */
  codes?: Record<string, string>;
}

interface SettingsRow { value_json: string }

const keyFor = (portalId: string) => `portal_categories:${portalId}`;

export class PortalCategoryRepository {
  constructor(private db: DatabaseSync) {}

  get(portalId: string): PortalCategoryList {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(keyFor(portalId)) as SettingsRow | undefined;
    if (!row) return { categories: [], readAt: null };
    try {
      const parsed = JSON.parse(row.value_json) as Partial<PortalCategoryList>;
      const categories = Array.isArray(parsed.categories) ? parsed.categories.filter((c): c is string => typeof c === 'string') : [];
      const codes = parsed.codes && typeof parsed.codes === 'object' ? parsed.codes : undefined;
      return { categories, readAt: typeof parsed.readAt === 'string' ? parsed.readAt : null, ...(codes ? { codes } : {}) };
    } catch {
      return { categories: [], readAt: null };
    }
  }

  save(portalId: string, categories: string[], readAt = new Date().toISOString(), codes?: Record<string, string>): PortalCategoryList {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const raw of categories) {
      const value = raw.trim().replace(/\s+/g, ' ');
      if (!value || seen.has(value)) continue;
      seen.add(value);
      unique.push(value);
    }
    if (unique.length === 0) return this.get(portalId);
    const next: PortalCategoryList = { categories: unique, readAt, ...(codes ? { codes } : {}) };
    this.db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(keyFor(portalId), JSON.stringify(next), readAt);
    return next;
  }
}
