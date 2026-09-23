import type { DatabaseSync } from 'node:sqlite';

const LEGACY_CREDENTIALS_KEY = 'portal_credentials';
const keyFor = (portalId: string) => `portal_credentials:${portalId}`;

interface SettingsRow {
  value_json: string;
}

export interface StoredPortalCredential {
  loginId: string;
  encryptedPasswordBase64: string | null;
}

function normalizeLoginId(value: string): string {
  const loginId = value.trim();
  if (loginId.length > 200) throw new Error('Portal login ID is too long.');
  return loginId;
}

export class PortalCredentialRepository {
  constructor(private db: DatabaseSync) {}

  get(portalId = 'tamil-nadu'): StoredPortalCredential {
    const row = this.db
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get(keyFor(portalId)) as SettingsRow | undefined;
    const legacyRow = portalId === 'tamil-nadu' && !row
      ? this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(LEGACY_CREDENTIALS_KEY) as SettingsRow | undefined
      : undefined;
    if (!row && !legacyRow) return { loginId: '', encryptedPasswordBase64: null };

    try {
      const parsed = JSON.parse((row ?? legacyRow)!.value_json) as Partial<StoredPortalCredential>;
      return {
        loginId: normalizeLoginId(typeof parsed.loginId === 'string' ? parsed.loginId : ''),
        encryptedPasswordBase64:
          typeof parsed.encryptedPasswordBase64 === 'string' && parsed.encryptedPasswordBase64.length > 0
            ? parsed.encryptedPasswordBase64
            : null,
      };
    } catch {
      return { loginId: '', encryptedPasswordBase64: null };
    }
  }

  save(input: StoredPortalCredential, portalId = 'tamil-nadu'): StoredPortalCredential {
    const stored: StoredPortalCredential = {
      loginId: normalizeLoginId(input.loginId),
      encryptedPasswordBase64: input.encryptedPasswordBase64?.trim() || null,
    };
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(keyFor(portalId), JSON.stringify(stored), now);
    return stored;
  }

  forgetPassword(portalId = 'tamil-nadu'): StoredPortalCredential {
    const current = this.get(portalId);
    return this.save({ ...current, encryptedPasswordBase64: null }, portalId);
  }
}
