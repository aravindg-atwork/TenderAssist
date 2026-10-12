import type { DatabaseSync } from 'node:sqlite';
import type { ReportSheetMode } from '../../publishing/jobPublisher.js';

const KEY = 'report_sheets';

/** How each day's report sheets are split: one per website (the default), or one for the whole day. */
export class ReportSheetSettingsRepository {
  constructor(private db: DatabaseSync) {}

  get(): ReportSheetMode {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(KEY) as { value_json: string } | undefined;
    try { return (JSON.parse(row?.value_json ?? '{}') as { mode?: unknown }).mode === 'ONE_PER_DAY' ? 'ONE_PER_DAY' : 'PER_WEBSITE'; }
    catch { return 'PER_WEBSITE'; }
  }

  save(mode: ReportSheetMode): ReportSheetMode {
    this.db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(KEY, JSON.stringify({ mode: mode === 'ONE_PER_DAY' ? 'ONE_PER_DAY' : 'PER_WEBSITE' }), new Date().toISOString());
    return this.get();
  }
}
