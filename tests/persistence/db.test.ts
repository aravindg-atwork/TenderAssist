// tests/persistence/db.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, withTransaction } from '../../src/persistence/db.js';

describe('createDatabase', () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it('creates the parent directory when it does not exist', () => {
    const base = mkdtempSync(join(tmpdir(), 'tenderassist-db-'));
    tempDirs.push(base);
    const dbPath = join(base, 'nested', 'missing', 'tenderassist.db');

    const db = createDatabase(dbPath);
    db.exec('CREATE TABLE t (id TEXT)');
    db.close();
  });

  it('sets WAL journal mode on a file-backed database', () => {
    const base = mkdtempSync(join(tmpdir(), 'tenderassist-db-'));
    tempDirs.push(base);
    const dbPath = join(base, 'tenderassist.db');

    const db = createDatabase(dbPath);
    const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(mode.journal_mode).toBe('wal');
    db.close();
  });
});

describe('withTransaction', () => {
  it('commits changes on success', () => {
    const db = createDatabase(':memory:');
    db.exec('CREATE TABLE t (id TEXT)');

    withTransaction(db, () => {
      db.prepare('INSERT INTO t (id) VALUES (?)').run('a');
    });

    expect(db.prepare('SELECT * FROM t').all()).toHaveLength(1);
  });

  it('rolls back changes when the callback throws', () => {
    const db = createDatabase(':memory:');
    db.exec('CREATE TABLE t (id TEXT)');

    expect(() =>
      withTransaction(db, () => {
        db.prepare('INSERT INTO t (id) VALUES (?)').run('a');
        throw new Error('boom');
      })
    ).toThrow('boom');

    expect(db.prepare('SELECT * FROM t').all()).toHaveLength(0);
  });
});
