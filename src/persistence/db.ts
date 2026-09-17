import type { DatabaseSync } from 'node:sqlite';

// Lazy load to avoid Vite bundling issues
function getDB() {
  const moduleName = ['node', 'sqlite'].join(':');
  return require(moduleName);
}

export function createDatabase(path: string): DatabaseSync {
  const { DatabaseSync } = getDB();
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
    db.exec('ROLLBACK');
    throw err;
  }
}
