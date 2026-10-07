import type { DatabaseSync } from 'node:sqlite';

/**
 * Where approved tenders are uploaded on Google Drive, and the sign-in used.
 * The client secret and the sign-in (refresh token) are stored encrypted by
 * the caller (Windows account protection); this store never sees them in clear.
 */
export interface GoogleDriveSettings {
  clientId: string;
  clientSecretEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  folderId: string;
  folderName: string;
  accountEmail: string;
  connectedAt: string | null;
}

const KEY = 'google_drive';

export const EMPTY_GOOGLE_DRIVE_SETTINGS: GoogleDriveSettings = {
  clientId: '', clientSecretEncrypted: null, refreshTokenEncrypted: null, folderId: '', folderName: '', accountEmail: '', connectedAt: null,
};

export class GoogleDriveSettingsRepository {
  constructor(private db: DatabaseSync) {}

  get(): GoogleDriveSettings {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(KEY) as { value_json: string } | undefined;
    if (!row) return { ...EMPTY_GOOGLE_DRIVE_SETTINGS };
    try {
      const saved = JSON.parse(row.value_json) as Partial<GoogleDriveSettings>;
      const text = (value: unknown) => (typeof value === 'string' ? value : '');
      const optional = (value: unknown) => (typeof value === 'string' && value ? value : null);
      return {
        clientId: text(saved.clientId),
        clientSecretEncrypted: optional(saved.clientSecretEncrypted),
        refreshTokenEncrypted: optional(saved.refreshTokenEncrypted),
        folderId: text(saved.folderId),
        folderName: text(saved.folderName),
        accountEmail: text(saved.accountEmail),
        connectedAt: optional(saved.connectedAt),
      };
    } catch {
      return { ...EMPTY_GOOGLE_DRIVE_SETTINGS };
    }
  }

  save(settings: GoogleDriveSettings): GoogleDriveSettings {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(KEY, JSON.stringify(settings), now);
    return settings;
  }
}
