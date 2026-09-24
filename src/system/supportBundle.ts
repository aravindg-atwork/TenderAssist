import type { DatabaseSync } from 'node:sqlite';
import { redact } from '../observability/logger.js';

// A support bundle helps diagnose a failed run without the operator's data
// leaving their control: job states, state changes, settings, and counts.
// Portal login IDs and passwords are reduced to "is one saved" flags, and
// every other setting passes through the same redaction as the logs.

const RECENT_JOB_LIMIT = 20;
const RECENT_TRANSITION_LIMIT = 300;

export interface SupportBundleContext {
  generatedAt: string;
  appVersion: string;
  environment: Record<string, unknown>;
  preflight?: unknown;
}

export interface SupportBundle extends SupportBundleContext {
  migrations: string[];
  tableCounts: Record<string, number>;
  recentJobs: Array<Record<string, unknown>>;
  recentTransitions: Array<Record<string, unknown>>;
  settings: Record<string, unknown>;
}

function credentialSummary(valueJson: string): { hasLoginId: boolean; hasSavedPassword: boolean } {
  try {
    const parsed = JSON.parse(valueJson) as { loginId?: unknown; encryptedPasswordBase64?: unknown };
    return {
      hasLoginId: typeof parsed.loginId === 'string' && parsed.loginId.length > 0,
      hasSavedPassword: typeof parsed.encryptedPasswordBase64 === 'string' && parsed.encryptedPasswordBase64.length > 0,
    };
  } catch {
    return { hasLoginId: false, hasSavedPassword: false };
  }
}

export function buildSupportBundle(db: DatabaseSync, context: SupportBundleContext): SupportBundle {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>)
    .map((row) => row.name);
  const tableCounts: Record<string, number> = {};
  for (const table of tables) {
    tableCounts[table] = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
  }

  const recentJobs = db.prepare(
    `SELECT j.id, j.state, j.created_at, j.updated_at, c.portal_id, c.search_date, c.product_categories_json AS product_categories
     FROM jobs j LEFT JOIN job_run_configs c ON c.job_id = j.id
     ORDER BY j.created_at DESC LIMIT ?`
  ).all(RECENT_JOB_LIMIT) as Array<Record<string, unknown>>;

  const recentTransitions = db.prepare(
    'SELECT entity_type, entity_id, from_state, to_state, reason, occurred_at FROM state_transitions ORDER BY occurred_at DESC LIMIT ?'
  ).all(RECENT_TRANSITION_LIMIT) as Array<Record<string, unknown>>;

  const settings: Record<string, unknown> = {};
  for (const row of db.prepare('SELECT key, value_json FROM app_settings ORDER BY key').all() as Array<{ key: string; value_json: string }>) {
    if (row.key.startsWith('portal_credentials')) {
      settings[row.key] = credentialSummary(row.value_json);
      continue;
    }
    try {
      const value = JSON.parse(row.value_json) as unknown;
      settings[row.key] = value && typeof value === 'object' && !Array.isArray(value) ? redact(value as Record<string, unknown>) : value;
    } catch {
      settings[row.key] = '[unreadable]';
    }
  }

  return {
    ...context,
    migrations: (db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>).map((row) => row.id),
    tableCounts,
    recentJobs,
    recentTransitions,
    settings,
  };
}
