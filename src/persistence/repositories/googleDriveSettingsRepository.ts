import type { DatabaseSync } from 'node:sqlite';

/** One website's Drive folder: named in TenderAssist (made in My Drive) or chosen in Google's folder chooser. */
export interface DriveFolder {
  /** Empty until the folder is found or made in My Drive. */
  folderId: string;
  folderName: string;
  /**
   * The operator chose this folder in Google's folder chooser (in My Drive,
   * shared with them, or in a shared drive), rather than TenderAssist making
   * it by name. A chosen folder that is gone is never made again in My Drive.
   */
  folderPicked: boolean;
}

export const NO_DRIVE_FOLDER: DriveFolder = { folderId: '', folderName: '', folderPicked: false };

/**
 * Where tenders are uploaded on Google Drive, and the sign-in used.
 * The client secret and the sign-in (refresh token) are stored encrypted by
 * the caller (Windows account protection); this store never sees them in clear.
 */
export interface GoogleDriveSettings {
  clientId: string;
  clientSecretEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  /**
   * Each website's own Drive folder, by website id (owner, 22 Oct 2026:
   * Tamil Nadu tenders to the Tamil Nadu folder, GeM bids to the GeM folder).
   * A website with no folder here uploads nothing, and its searches wait for one.
   */
  portalFolders: Record<string, DriveFolder>;
  /** The one folder every website shared before 0.7.7; kept only to say where earlier uploads went. */
  folderId: string;
  folderName: string;
  folderPicked: boolean;
  accountEmail: string;
  connectedAt: string | null;
  /** SAVED: everything a search saves goes to Drive after the run. APPROVED: only tenders the operator approves. */
  uploadMode: 'SAVED' | 'APPROVED';
}

const KEY = 'google_drive';

export const EMPTY_GOOGLE_DRIVE_SETTINGS: GoogleDriveSettings = {
  clientId: '', clientSecretEncrypted: null, refreshTokenEncrypted: null, portalFolders: {}, folderId: '', folderName: '', folderPicked: false, accountEmail: '', connectedAt: null, uploadMode: 'SAVED',
};

/** A website's Drive folder, or no folder. */
export function driveFolderOf(settings: GoogleDriveSettings, portalId: string): DriveFolder {
  return settings.portalFolders[portalId] ?? NO_DRIVE_FOLDER;
}

/** Whether a website has a Drive folder named or chosen. */
export function hasDriveFolder(folder: DriveFolder): boolean {
  return Boolean(folder.folderName || folder.folderId);
}

export class GoogleDriveSettingsRepository {
  constructor(private db: DatabaseSync) {}

  get(): GoogleDriveSettings {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(KEY) as { value_json: string } | undefined;
    if (!row) return { ...EMPTY_GOOGLE_DRIVE_SETTINGS, portalFolders: {} };
    try {
      const saved = JSON.parse(row.value_json) as Partial<GoogleDriveSettings>;
      const text = (value: unknown) => (typeof value === 'string' ? value : '');
      const optional = (value: unknown) => (typeof value === 'string' && value ? value : null);
      const portalFolders: Record<string, DriveFolder> = {};
      if (saved.portalFolders && typeof saved.portalFolders === 'object') {
        for (const [portalId, value] of Object.entries(saved.portalFolders as Record<string, Partial<DriveFolder>>)) {
          const folder = { folderId: text(value?.folderId), folderName: text(value?.folderName), folderPicked: value?.folderPicked === true };
          if (hasDriveFolder(folder)) portalFolders[portalId] = folder;
        }
      }
      return {
        clientId: text(saved.clientId),
        clientSecretEncrypted: optional(saved.clientSecretEncrypted),
        refreshTokenEncrypted: optional(saved.refreshTokenEncrypted),
        portalFolders,
        folderId: text(saved.folderId),
        folderName: text(saved.folderName),
        folderPicked: saved.folderPicked === true,
        accountEmail: text(saved.accountEmail),
        connectedAt: optional(saved.connectedAt),
        uploadMode: saved.uploadMode === 'APPROVED' ? 'APPROVED' : 'SAVED',
      };
    } catch {
      return { ...EMPTY_GOOGLE_DRIVE_SETTINGS, portalFolders: {} };
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

  /** Sets (or, with no folder, clears) one website's Drive folder. */
  saveFolder(portalId: string, folder: DriveFolder): GoogleDriveSettings {
    const settings = this.get();
    const portalFolders = { ...settings.portalFolders };
    if (hasDriveFolder(folder)) portalFolders[portalId] = folder;
    else delete portalFolders[portalId];
    return this.save({ ...settings, portalFolders });
  }
}
