import type { DatabaseSync } from 'node:sqlite';
import { mergeCategoryHistory, type CategoryHistory } from '../../config/categoryHealth.js';

/** The Product Category list as the website itself shows it, read during a search. */
export interface PortalCategoryList {
  categories: string[];
  /** When a search last read the list; null before the first search. */
  readAt: string | null;
  /** The website's own code for each category, by name, where it has one (GeM). */
  codes?: Record<string, string>;
  /** First and last read that had each category, by `categoryKey`. */
  history?: CategoryHistory;
  /** The first read that kept history. */
  historySince?: string | null;
  /** When the operator last looked at the categories new on the website. */
  newLookedAt?: string | null;
}

interface SettingsRow { value_json: string }

const keyFor = (portalId: string) => `portal_categories:${portalId}`;
const text = (value: unknown) => (typeof value === 'string' ? value : null);

export class PortalCategoryRepository {
  constructor(private db: DatabaseSync) {}

  get(portalId: string): PortalCategoryList {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(keyFor(portalId)) as SettingsRow | undefined;
    if (!row) return { categories: [], readAt: null };
    try {
      const parsed = JSON.parse(row.value_json) as Partial<PortalCategoryList>;
      const categories = Array.isArray(parsed.categories) ? parsed.categories.filter((c): c is string => typeof c === 'string') : [];
      const codes = parsed.codes && typeof parsed.codes === 'object' ? parsed.codes : undefined;
      const history = parsed.history && typeof parsed.history === 'object' ? parsed.history : undefined;
      return {
        categories,
        readAt: text(parsed.readAt),
        ...(codes ? { codes } : {}),
        ...(history ? { history, historySince: text(parsed.historySince), newLookedAt: text(parsed.newLookedAt) } : {}),
      };
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
    const previous = this.get(portalId);
    // Lists saved before history was kept count as the first sighting.
    const seeded = previous.history ?? (previous.readAt ? mergeCategoryHistory(undefined, previous.categories, previous.readAt) : undefined);
    const next: PortalCategoryList = {
      categories: unique,
      readAt,
      ...(codes ? { codes } : {}),
      history: mergeCategoryHistory(seeded, unique, readAt),
      historySince: previous.historySince ?? previous.readAt ?? readAt,
      newLookedAt: previous.newLookedAt ?? null,
    };
    this.write(portalId, next, readAt);
    return next;
  }

  /** The operator has seen the categories new on the website; only later ones count as new. */
  markNewLooked(portalId: string, at = new Date().toISOString()): PortalCategoryList {
    const list = this.get(portalId);
    if (!list.readAt) return list;
    const next = { ...list, newLookedAt: at };
    this.write(portalId, next, at);
    return next;
  }

  private write(portalId: string, list: PortalCategoryList, at: string): void {
    this.db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(keyFor(portalId), JSON.stringify(list), at);
  }
}
