import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import {
  driveFolderOf,
  GoogleDriveSettingsRepository,
  hasDriveFolder,
  NO_DRIVE_FOLDER,
} from '../../../src/persistence/repositories/googleDriveSettingsRepository.js';

describe('GoogleDriveSettingsRepository', () => {
  let db: DatabaseSync;
  let repo: GoogleDriveSettingsRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new GoogleDriveSettingsRepository(db);
  });

  it('keeps a Drive folder for each website, apart', () => {
    repo.saveFolder('tamil-nadu', { folderId: '', folderName: 'TN Tenders', folderPicked: false });
    repo.saveFolder('gem', { folderId: 'abc', folderName: 'GeM Bids', folderPicked: true });
    const settings = repo.get();
    expect(driveFolderOf(settings, 'tamil-nadu')).toEqual({ folderId: '', folderName: 'TN Tenders', folderPicked: false });
    expect(driveFolderOf(settings, 'gem')).toEqual({ folderId: 'abc', folderName: 'GeM Bids', folderPicked: true });
    expect(driveFolderOf(settings, 'kerala')).toEqual(NO_DRIVE_FOLDER);
    expect(hasDriveFolder(driveFolderOf(settings, 'kerala'))).toBe(false);
  });

  it('changes one website’s folder without touching another’s, and clears it with no folder', () => {
    repo.saveFolder('tamil-nadu', { folderId: 'x', folderName: 'TN Tenders', folderPicked: false });
    repo.saveFolder('gem', { folderId: 'abc', folderName: 'GeM Bids', folderPicked: true });
    repo.saveFolder('tamil-nadu', { folderId: '', folderName: 'Tamil Nadu 2026', folderPicked: false });
    expect(driveFolderOf(repo.get(), 'tamil-nadu').folderName).toBe('Tamil Nadu 2026');
    expect(driveFolderOf(repo.get(), 'gem').folderId).toBe('abc');
    repo.saveFolder('gem', NO_DRIVE_FOLDER);
    expect(Object.keys(repo.get().portalFolders)).toEqual(['tamil-nadu']);
  });

  it('does not hand the one folder of earlier versions to any website', () => {
    db.prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run('google_drive', JSON.stringify({ folderId: 'old', folderName: 'Tenders', folderPicked: false, accountEmail: 'a@b.c' }), new Date().toISOString());
    const settings = repo.get();
    expect(settings.portalFolders).toEqual({});
    expect(settings.folderName).toBe('Tenders');
    expect(settings.accountEmail).toBe('a@b.c');
  });
});
