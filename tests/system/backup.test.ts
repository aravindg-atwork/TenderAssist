import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { createDatabase } from '../../src/persistence/db.js';
import { PortalCredentialRepository } from '../../src/persistence/repositories/portalCredentialRepository.js';
import { applyPendingRestore, createBackup, inspectBackup, stageRestore } from '../../src/system/backup.js';

const MIGRATIONS = join(process.cwd(), 'src', 'persistence', 'migrations');

describe('backup and restore', () => {
  let dir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ta-backup-'));
    db = createDatabase(join(dir, 'tenderassist.db'));
    runMigrations(db, MIGRATIONS);
    db.prepare("INSERT INTO jobs (id, state, created_at, updated_at) VALUES ('job-1', 'COMPLETE', '2026-09-24T00:00:00Z', '2026-09-24T00:00:00Z')").run();
    new PortalCredentialRepository(db).save({ loginId: 'operator', encryptedPasswordBase64: 'c2VjcmV0' }, 'tamil-nadu');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a complete copy without saved portal passwords', () => {
    const target = join(dir, 'backup.db');
    createBackup(db, target);

    const copy = new DatabaseSync(target);
    expect((copy.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n).toBe(1);
    const credential = new PortalCredentialRepository(copy).get('tamil-nadu');
    copy.close();
    expect(credential).toEqual({ loginId: 'operator', encryptedPasswordBase64: null });
    // The live database keeps its password.
    expect(new PortalCredentialRepository(db).get('tamil-nadu').encryptedPasswordBase64).toBe('c2VjcmV0');
  });

  it('replaces an existing file at the chosen path', () => {
    const target = join(dir, 'backup.db');
    writeFileSync(target, 'old');
    createBackup(db, target);
    expect(inspectBackup(target, MIGRATIONS).jobCount).toBe(1);
  });

  it('describes a valid backup', () => {
    const target = join(dir, 'backup.db');
    createBackup(db, target);
    expect(inspectBackup(target, MIGRATIONS)).toMatchObject({ jobCount: 1, tenderCount: 0 });
  });

  it('rejects a file that is not a TenderAssist backup', () => {
    const target = join(dir, 'notes.db');
    writeFileSync(target, 'hello');
    expect(() => inspectBackup(target, MIGRATIONS)).toThrow('not a TenderAssist backup');

    const other = new DatabaseSync(join(dir, 'other.db'));
    other.exec('CREATE TABLE things (id TEXT)');
    other.close();
    expect(() => inspectBackup(join(dir, 'other.db'), MIGRATIONS)).toThrow('not a TenderAssist backup');
  });

  it('rejects a backup made by a newer TenderAssist', () => {
    const target = join(dir, 'backup.db');
    createBackup(db, target);
    const copy = new DatabaseSync(target);
    copy.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES ('999_future.sql', '')").run();
    copy.close();
    expect(() => inspectBackup(target, MIGRATIONS)).toThrow('newer version');
  });

  it('swaps in a staged backup at next start and keeps the previous database', () => {
    const target = join(dir, 'backup.db');
    createBackup(db, target);
    db.prepare("INSERT INTO jobs (id, state, created_at, updated_at) VALUES ('job-2', 'COMPLETE', '2026-09-24T00:00:00Z', '2026-09-24T00:00:00Z')").run();
    db.close();

    const dbPath = join(dir, 'tenderassist.db');
    stageRestore(target, dbPath);
    const previous = applyPendingRestore(dbPath, new Date('2026-09-24T10:00:00Z'));

    expect(previous).toBeTruthy();
    expect(existsSync(previous!)).toBe(true);
    db = createDatabase(dbPath);
    expect((db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n).toBe(1);
    const kept = new DatabaseSync(previous!);
    expect((kept.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n).toBe(2);
    kept.close();
    expect(readdirSync(dir).some((file) => file.endsWith('.restore-pending'))).toBe(false);
  });

  it('does nothing when no restore is staged', () => {
    expect(applyPendingRestore(join(dir, 'tenderassist.db'))).toBeNull();
  });
});
