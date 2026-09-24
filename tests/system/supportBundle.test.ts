import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { PortalCredentialRepository } from '../../src/persistence/repositories/portalCredentialRepository.js';
import { buildSupportBundle } from '../../src/system/supportBundle.js';

describe('buildSupportBundle', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    db.prepare("INSERT INTO jobs (id, state, created_at, updated_at) VALUES ('job-1', 'FAILED_MANUAL', '2026-09-24T01:00:00Z', '2026-09-24T02:00:00Z')").run();
    db.prepare("INSERT INTO state_transitions (id, entity_type, entity_id, from_state, to_state, reason, occurred_at) VALUES ('t1', 'job', 'job-1', 'SEARCHING', 'FAILED_MANUAL', 'portal timeout', '2026-09-24T02:00:00Z')").run();
    new PortalCredentialRepository(db).save({ loginId: 'operator@example', encryptedPasswordBase64: 'c2VjcmV0' }, 'tamil-nadu');
    db.prepare("INSERT INTO app_settings (key, value_json, updated_at) VALUES ('automation_pacing', '{\"mode\":\"HUMAN\",\"minDelayMs\":2000}', '')").run();
  });

  const build = () => buildSupportBundle(db, {
    generatedAt: '2026-09-24T03:00:00Z',
    appVersion: '0.3.6',
    environment: { platform: 'win32' },
  });

  it('includes recent jobs, their transitions, and table counts', () => {
    const bundle = build();
    expect(bundle.appVersion).toBe('0.3.6');
    expect(bundle.recentJobs).toEqual([expect.objectContaining({ id: 'job-1', state: 'FAILED_MANUAL' })]);
    expect(bundle.recentTransitions).toEqual([expect.objectContaining({ entity_id: 'job-1', reason: 'portal timeout' })]);
    expect(bundle.tableCounts.jobs).toBe(1);
    expect(bundle.migrations).toContain('001_init.sql');
  });

  it('never contains login IDs or saved passwords', () => {
    const text = JSON.stringify(build());
    expect(text).not.toContain('operator@example');
    expect(text).not.toContain('c2VjcmV0');
    expect(build().settings['portal_credentials:tamil-nadu']).toEqual({ hasLoginId: true, hasSavedPassword: true });
  });

  it('keeps ordinary settings readable', () => {
    expect(build().settings.automation_pacing).toEqual({ mode: 'HUMAN', minDelayMs: 2000 });
  });
});
