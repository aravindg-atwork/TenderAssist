import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_RUN_DEFAULTS,
  normalizeRunConfiguration,
  normalizeRunDefaults,
  type RunConfiguration,
  type RunDefaults,
} from '../../config/runConfiguration.js';

const DEFAULTS_KEY = 'run_defaults';

interface SettingsRow {
  value_json: string;
}

interface JobConfigRow {
  portal_id: string;
  search_date: string;
  product_categories_json: string;
  keywords_json: string;
  excluded_keywords_json: string;
}

export class RunConfigurationRepository {
  constructor(private db: DatabaseSync) {}

  hasSavedDefaults(): boolean {
    return Boolean(
      this.db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(DEFAULTS_KEY)
    );
  }

  getDefaults(): RunDefaults {
    const row = this.db
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get(DEFAULTS_KEY) as SettingsRow | undefined;
    if (!row) return structuredClone(DEFAULT_RUN_DEFAULTS);
    try {
      return normalizeRunDefaults(JSON.parse(row.value_json) as RunDefaults);
    } catch {
      return structuredClone(DEFAULT_RUN_DEFAULTS);
    }
  }

  saveDefaults(input: RunDefaults): RunDefaults {
    const defaults = normalizeRunDefaults(input);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(DEFAULTS_KEY, JSON.stringify(defaults), now);
    return defaults;
  }

  saveForJob(jobId: string, input: RunConfiguration): RunConfiguration {
    const config = normalizeRunConfiguration(input);
    this.db
      .prepare(
        `INSERT INTO job_run_configs
           (job_id, search_date, product_categories_json, keywords_json, excluded_keywords_json, created_at, portal_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        jobId,
        config.searchDate,
        JSON.stringify(config.productCategories),
        JSON.stringify(config.keywords),
        JSON.stringify(config.excludedKeywords),
        new Date().toISOString(),
        config.portalId ?? 'tamil-nadu'
      );
    return config;
  }

  /** Remember the confirmed tender selection so an interrupted run can resume downloads. */
  saveSelection(jobId: string, tenderIds: string[]): void {
    this.db.prepare('UPDATE job_run_configs SET selected_tender_ids_json = ? WHERE job_id = ?')
      .run(JSON.stringify([...new Set(tenderIds)]), jobId);
  }

  /** The confirmed selection, or null when the operator has not confirmed one. */
  getSelection(jobId: string): string[] | null {
    const row = this.db.prepare('SELECT selected_tender_ids_json FROM job_run_configs WHERE job_id = ?')
      .get(jobId) as { selected_tender_ids_json: string | null } | undefined;
    if (!row?.selected_tender_ids_json) return null;
    try {
      const parsed = JSON.parse(row.selected_tender_ids_json) as unknown;
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : null;
    } catch {
      return null;
    }
  }

  getForJob(jobId: string): RunConfiguration | undefined {
    const row = this.db
      .prepare(
        `SELECT portal_id, search_date, product_categories_json, keywords_json, excluded_keywords_json
         FROM job_run_configs WHERE job_id = ?`
      )
      .get(jobId) as JobConfigRow | undefined;
    if (!row) return undefined;
    return normalizeRunConfiguration({
      searchDate: row.search_date,
      portalId: row.portal_id,
      productCategories: JSON.parse(row.product_categories_json) as string[],
      keywords: JSON.parse(row.keywords_json) as string[],
      excludedKeywords: JSON.parse(row.excluded_keywords_json) as string[],
    });
  }

  listRecentRunDates(portalId: string, limit = 5): string[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT config.search_date
       FROM job_run_configs config
       WHERE config.portal_id = ?
       ORDER BY config.search_date DESC
       LIMIT ?`
    ).all(portalId, limit) as unknown as Array<{ search_date: string }>;
    return rows.map((row) => row.search_date);
  }

  /** Published dates that have a completed run for the portal. */
  listCompletedRunDates(portalId: string): string[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT config.search_date
       FROM job_run_configs config
       JOIN jobs ON jobs.id = config.job_id
       WHERE config.portal_id = ? AND jobs.state = 'COMPLETE'`
    ).all(portalId) as unknown as Array<{ search_date: string }>;
    return rows.map((row) => row.search_date);
  }

  deleteForJob(jobId: string): void {
    this.db.prepare('DELETE FROM job_run_configs WHERE job_id = ?').run(jobId);
  }
}
