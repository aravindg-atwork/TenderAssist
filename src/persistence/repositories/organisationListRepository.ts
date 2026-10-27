import type { DatabaseSync } from 'node:sqlite';

/** A website's organisations, offered in Settings → Organisations to search. */
export interface OrganisationList {
  names: string[];
  readAt: string | null;
}

/** The most names kept per website: GeM's ministries and departments run to a few thousand. */
const MAX_NAMES = 5_000;

const keyFor = (portalId: string) => `portal_organisations:${portalId}`;

export class OrganisationListRepository {
  constructor(private db: DatabaseSync) {}

  get(portalId: string): OrganisationList {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(keyFor(portalId)) as { value_json: string } | undefined;
    if (!row) return { names: [], readAt: null };
    try {
      const parsed = JSON.parse(row.value_json) as Partial<OrganisationList>;
      return {
        names: Array.isArray(parsed.names) ? parsed.names.filter((name): name is string => typeof name === 'string') : [],
        readAt: typeof parsed.readAt === 'string' ? parsed.readAt : null,
      };
    } catch {
      return { names: [], readAt: null };
    }
  }

  /**
   * Saves the website's list: `replace` for a full list (Tamil Nadu's
   * public page), else the names are added to those seen before (GeM's
   * buyers, a day at a time).
   */
  save(portalId: string, names: readonly string[], options: { replace?: boolean; readAt?: string } = {}): OrganisationList {
    const merged = new Map<string, string>();
    for (const raw of [...(options.replace ? [] : this.get(portalId).names), ...names]) {
      const name = raw.trim().replace(/\s+/g, ' ');
      if (name && !merged.has(name.toLocaleLowerCase())) merged.set(name.toLocaleLowerCase(), name);
    }
    const list: OrganisationList = {
      names: [...merged.values()].sort((a, b) => a.localeCompare(b)).slice(0, MAX_NAMES),
      readAt: options.readAt ?? new Date().toISOString(),
    };
    this.db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(keyFor(portalId), JSON.stringify(list), new Date().toISOString());
    return list;
  }
}
