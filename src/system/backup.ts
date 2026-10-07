import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';

// Backups are a single SQLite file. Restores are staged beside the live
// database and swapped in at the next start, before SQLite opens it, so the
// open database file is never overwritten underneath the running app.

const REQUIRED_TABLES = ['schema_migrations', 'jobs', 'app_settings'];

export interface BackupSummary {
  jobCount: number;
  tenderCount: number;
  lastChangedAt: string | null;
}

export function pendingRestorePath(dbPath: string): string {
  return `${dbPath}.restore-pending`;
}

/**
 * Write a consistent copy of the database to `destination`. Saved portal
 * passwords are removed from the copy: they are encrypted for this Windows
 * account only and must never travel inside a file the operator may share.
 */
export function createBackup(db: DatabaseSync, destination: string): void {
  const staging = `${destination}.writing`;
  rmSync(staging, { force: true });
  db.prepare('VACUUM INTO ?').run(staging);
  try {
    const copy = new DatabaseSync(staging);
    try {
      const rows = copy.prepare("SELECT key, value_json FROM app_settings WHERE key LIKE 'portal_credentials%'").all() as Array<{ key: string; value_json: string }>;
      const update = copy.prepare('UPDATE app_settings SET value_json = ? WHERE key = ?');
      for (const row of rows) {
        let loginId = '';
        try {
          const parsed = JSON.parse(row.value_json) as { loginId?: unknown };
          if (typeof parsed.loginId === 'string') loginId = parsed.loginId;
        } catch { /* an unreadable entry is replaced with an empty one */ }
        update.run(JSON.stringify({ loginId, encryptedPasswordBase64: null }), row.key);
      }
      // The Google sign-in and client secret are encrypted for this Windows account too.
      const drive = copy.prepare("SELECT value_json FROM app_settings WHERE key = 'google_drive'").get() as { value_json: string } | undefined;
      if (drive) {
        try {
          const parsed = JSON.parse(drive.value_json) as Record<string, unknown>;
          update.run(JSON.stringify({ ...parsed, clientSecretEncrypted: null, refreshTokenEncrypted: null, accountEmail: '', connectedAt: null }), 'google_drive');
        } catch {
          update.run('{}', 'google_drive');
        }
      }
    } finally {
      copy.close();
    }
    rmSync(destination, { force: true });
    renameSync(staging, destination);
  } catch (error) {
    rmSync(staging, { force: true });
    throw error;
  }
}

/** Confirm a file is a TenderAssist backup this version can open, and describe it. */
export function inspectBackup(path: string, migrationsDir: string): BackupSummary {
  let backup: DatabaseSync;
  try {
    backup = new DatabaseSync(path, { readOnly: true });
  } catch {
    throw new Error('This file is not a TenderAssist backup.');
  }
  try {
    let tables: Set<string>;
    try {
      tables = new Set((backup.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
    } catch {
      throw new Error('This file is not a TenderAssist backup.');
    }
    if (!REQUIRED_TABLES.every((table) => tables.has(table))) throw new Error('This file is not a TenderAssist backup.');

    const known = new Set(readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')));
    const applied = (backup.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>).map((row) => row.id);
    if (applied.some((id) => !known.has(id))) {
      throw new Error('This backup was made by a newer version of TenderAssist. Update TenderAssist, then restore it.');
    }

    const count = (table: string) => tables.has(table)
      ? (backup.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
      : 0;
    const lastChangedAt = (backup.prepare('SELECT MAX(updated_at) AS at FROM jobs').get() as { at: string | null }).at;
    return { jobCount: count('jobs'), tenderCount: count('opportunities'), lastChangedAt };
  } finally {
    backup.close();
  }
}

/** Copy a validated backup next to the live database for swapping in at next start. */
export function stageRestore(backupPath: string, dbPath: string): void {
  copyFileSync(backupPath, pendingRestorePath(dbPath));
}

/**
 * Swap a staged backup in before the database is opened. The previous
 * database (with its WAL and SHM files) is kept beside it, never deleted.
 * Returns the kept database path, or null when nothing was staged.
 */
export function applyPendingRestore(dbPath: string, now = new Date()): string | null {
  const pending = pendingRestorePath(dbPath);
  if (!existsSync(pending)) return null;
  const kept = `${dbPath}.before-restore-${now.toISOString().replaceAll(':', '-')}`;
  if (existsSync(dbPath)) renameSync(dbPath, kept);
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(`${dbPath}${suffix}`)) renameSync(`${dbPath}${suffix}`, `${kept}${suffix}`);
  }
  renameSync(pending, dbPath);
  return existsSync(kept) ? kept : null;
}
