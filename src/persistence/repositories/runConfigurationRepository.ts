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
  search_date: string;
  product_categories_json: string;
  keywords_json: string;
  excluded_keywords_json: string;
}

export class RunConfigurationRepository {
  constructor(private db: DatabaseSync) {}

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
           (job_id, search_date, product_categories_json, keywords_json, excluded_keywords_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        jobId,
        config.searchDate,
        JSON.stringify(config.productCategories),
        JSON.stringify(config.keywords),
        JSON.stringify(config.excludedKeywords),
        new Date().toISOString()
      );
    return config;
  }

  getForJob(jobId: string): RunConfiguration | undefined {
    const row = this.db
      .prepare(
        `SELECT search_date, product_categories_json, keywords_json, excluded_keywords_json
         FROM job_run_configs WHERE job_id = ?`
      )
      .get(jobId) as JobConfigRow | undefined;
    if (!row) return undefined;
    return normalizeRunConfiguration({
      searchDate: row.search_date,
      productCategories: JSON.parse(row.product_categories_json) as string[],
      keywords: JSON.parse(row.keywords_json) as string[],
      excludedKeywords: JSON.parse(row.excluded_keywords_json) as string[],
    });
  }

  deleteForJob(jobId: string): void {
    this.db.prepare('DELETE FROM job_run_configs WHERE job_id = ?').run(jobId);
  }
}
