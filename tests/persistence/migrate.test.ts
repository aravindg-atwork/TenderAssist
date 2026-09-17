// tests/persistence/migrate.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';

describe('runMigrations', () => {
  let db: DatabaseSync;
  let migrationsDir: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrationsDir = mkdtempSync(join(tmpdir(), 'tenderassist-migrations-'));
    writeFileSync(
      join(migrationsDir, '001_test.sql'),
      'CREATE TABLE widgets (id TEXT PRIMARY KEY);'
    );
  });

  afterEach(() => {
    // Plain temp dir with a SQL file, nothing holds an open handle on it
    // (unlike the Chrome-profile-dir case elsewhere), so a bare rmSync is
    // sufficient -- no retry needed.
    rmSync(migrationsDir, { recursive: true, force: true });
  });

  it('applies pending migrations', () => {
    runMigrations(db, migrationsDir);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'widgets'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it('does not re-apply an already-applied migration', () => {
    runMigrations(db, migrationsDir);
    db.prepare('INSERT INTO widgets (id) VALUES (?)').run('one');
    runMigrations(db, migrationsDir);
    const rows = db.prepare('SELECT * FROM widgets').all();
    expect(rows).toHaveLength(1);
  });

  it('applies the real 001_init migration creating jobs and state_transitions', () => {
    const realDb = new DatabaseSync(':memory:');
    runMigrations(realDb, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const names = realDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row: any) => row.name);
    expect(names).toEqual(expect.arrayContaining(['jobs', 'state_transitions']));
    realDb.close();
  });
});
