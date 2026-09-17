import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
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
