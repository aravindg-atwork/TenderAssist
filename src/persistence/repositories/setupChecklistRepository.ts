import type { DatabaseSync } from 'node:sqlite';

/** The first-time setup checklist: the operator's own choices and confirmations (the rest is read from the app's state). */
export interface SetupChecklistState {
  /** The website the operator mainly searches, chosen in step 2. */
  portalId: string | null;
  /** When the operator confirmed each word list (steps the app cannot judge by itself). */
  confirmed: { categories?: string; intent?: string; excluded?: string };
  /** Set once every step was done (or for a PC that was already in use); the checklist then stays away. */
  completedAt: string | null;
}

const KEY = 'setup_checklist';
const EMPTY: SetupChecklistState = { portalId: null, confirmed: {}, completedAt: null };

export class SetupChecklistRepository {
  constructor(private db: DatabaseSync) {}

  get(): SetupChecklistState | null {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(KEY) as { value_json: string } | undefined;
    if (!row) return null;
    try {
      const saved = JSON.parse(row.value_json) as Partial<SetupChecklistState>;
      const when = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
      const confirmed = saved.confirmed ?? {};
      return {
        portalId: typeof saved.portalId === 'string' && saved.portalId ? saved.portalId : null,
        confirmed: { categories: when(confirmed.categories), intent: when(confirmed.intent), excluded: when(confirmed.excluded) },
        completedAt: when(saved.completedAt) ?? null,
      };
    } catch {
      return { ...EMPTY };
    }
  }

  save(state: SetupChecklistState): SetupChecklistState {
    this.db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(KEY, JSON.stringify(state), new Date().toISOString());
    return state;
  }

  static empty(): SetupChecklistState {
    return { ...EMPTY, confirmed: {} };
  }
}
