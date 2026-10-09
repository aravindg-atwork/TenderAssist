import type { DatabaseSync } from 'node:sqlite';

const SETTINGS_KEY = 'automation_pacing';

export type AutomationPacingMode = 'HUMAN' | 'FAST' | 'CUSTOM';

/** How the login is typed: one key at a time like a person, or all at once. Separate from the pause between clicks. */
export type TypingStyle = 'HUMAN' | 'INSTANT';

export interface AutomationPacingSettings {
  mode: AutomationPacingMode;
  minDelayMs: number;
  maxDelayMs: number;
  typing?: TypingStyle;
}

export const DEFAULT_AUTOMATION_PACING: AutomationPacingSettings = {
  mode: 'HUMAN',
  minDelayMs: 2_000,
  maxDelayMs: 5_000,
  typing: 'HUMAN',
};

interface SettingsRow { value_json: string }

function normalize(input: AutomationPacingSettings): AutomationPacingSettings {
  const typing: TypingStyle = input.typing === 'INSTANT' ? 'INSTANT' : 'HUMAN';
  if (input.mode === 'FAST') return { mode: 'FAST', minDelayMs: 0, maxDelayMs: 0, typing };
  const minDelayMs = Math.round(Number(input.minDelayMs));
  const maxDelayMs = Math.round(Number(input.maxDelayMs));
  if (!Number.isFinite(minDelayMs) || !Number.isFinite(maxDelayMs)) {
    throw new Error('Action delay must be a valid number.');
  }
  if (minDelayMs < 0 || maxDelayMs > 60_000 || minDelayMs > maxDelayMs) {
    throw new Error('Action delay must be between 0 and 60 seconds, with minimum no greater than maximum.');
  }
  return { mode: input.mode === 'CUSTOM' ? 'CUSTOM' : 'HUMAN', minDelayMs, maxDelayMs, typing };
}

export class AutomationSettingsRepository {
  constructor(private db: DatabaseSync) {}

  get(): AutomationPacingSettings {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(SETTINGS_KEY) as SettingsRow | undefined;
    if (!row) return DEFAULT_AUTOMATION_PACING;
    try {
      return normalize(JSON.parse(row.value_json) as AutomationPacingSettings);
    } catch {
      return DEFAULT_AUTOMATION_PACING;
    }
  }

  save(input: AutomationPacingSettings): AutomationPacingSettings {
    const next = normalize(input);
    this.db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(SETTINGS_KEY, JSON.stringify(next), new Date().toISOString());
    return next;
  }
}
