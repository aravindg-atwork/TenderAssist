import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

function openConfiguredDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    return db;
  } catch (error) {
    try { db.close(); } catch { /* preserve the original SQLite error */ }
    throw error;
  }
}

function isDiskIoError(error: unknown): boolean {
  return error instanceof Error && /disk I\/O error/i.test(error.message);
}

export function quarantineStaleSharedMemory(path: string, now = new Date()): string | null {
  const sharedMemoryPath = `${path}-shm`;
  if (!existsSync(sharedMemoryPath)) return null;
  const recoveryStamp = now.toISOString().replaceAll(':', '-');
  const quarantinedPath = `${sharedMemoryPath}.stale-${recoveryStamp}`;
  renameSync(sharedMemoryPath, quarantinedPath);
  return quarantinedPath;
}

export function createDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  try {
    return openConfiguredDatabase(path);
  } catch (error) {
    if (path === ':memory:' || !isDiskIoError(error)) throw error;

    // A terminated Electron/SQLite process can leave a stale shared-memory
    // index behind. The WAL remains authoritative and SQLite can rebuild the
    // SHM file safely once this single application instance owns the DB.
    if (!quarantineStaleSharedMemory(path)) throw error;
    return openConfiguredDatabase(path);
  }
}

export function withTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackErr) {
      throw new Error(
        `Transaction failed and rollback also failed: ${(rollbackErr as Error).message}`,
        { cause: err }
      );
    }
    throw err;
  }
}
