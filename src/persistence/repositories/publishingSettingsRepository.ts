import type { DatabaseSync } from 'node:sqlite';

const LEGACY_KEY = 'publishing_settings';
const keyFor = (portalId: string) => `publishing_settings:${portalId}`;

export interface PublishingSettings {
  localOutputRoot: string;
  driveOutputRoot: string;
}

interface SettingsRow { value_json: string }

export class PublishingSettingsRepository {
  constructor(private db: DatabaseSync, private defaultOutputRoot: string) {}

  get(portalId = 'tamil-nadu'): PublishingSettings {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(keyFor(portalId)) as SettingsRow | undefined;
    const legacyRow = portalId === 'tamil-nadu' && !row
      ? this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(LEGACY_KEY) as SettingsRow | undefined
      : undefined;
    if (!row && !legacyRow) return { localOutputRoot: this.defaultOutputRoot, driveOutputRoot: '' };
    try {
      const parsed = JSON.parse((row ?? legacyRow)!.value_json) as Partial<PublishingSettings> & { outputRoot?: string };
      const legacyOutput = typeof parsed.outputRoot === 'string' ? parsed.outputRoot : '';
      return {
        localOutputRoot: typeof parsed.localOutputRoot === 'string' && parsed.localOutputRoot.trim()
          ? parsed.localOutputRoot.trim()
          : legacyOutput.trim() || this.defaultOutputRoot,
        driveOutputRoot: typeof parsed.driveOutputRoot === 'string' ? parsed.driveOutputRoot.trim() : '',
      };
    } catch {
      return { localOutputRoot: this.defaultOutputRoot, driveOutputRoot: '' };
    }
  }

  save(input: PublishingSettings, portalId = 'tamil-nadu'): PublishingSettings {
    const localOutputRoot = input.localOutputRoot?.trim();
    if (!localOutputRoot) throw new Error('Choose a local output folder.');
    const next = { localOutputRoot, driveOutputRoot: input.driveOutputRoot?.trim() ?? '' };
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(keyFor(portalId), JSON.stringify(next), now);
    return next;
  }
}
