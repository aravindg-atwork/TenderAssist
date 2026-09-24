import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import {
  AutomationSettingsRepository,
  DEFAULT_AUTOMATION_PACING,
} from '../../../src/persistence/repositories/automationSettingsRepository.js';

describe('AutomationSettingsRepository', () => {
  let db: DatabaseSync;
  let repo: AutomationSettingsRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new AutomationSettingsRepository(db);
  });

  it('defaults to randomized human-paced actions', () => {
    expect(repo.get()).toEqual(DEFAULT_AUTOMATION_PACING);
  });

  it('preserves the legacy fast behavior as an explicit zero-delay mode', () => {
    expect(repo.save({ mode: 'FAST', minDelayMs: 12_000, maxDelayMs: 30_000 })).toEqual({
      mode: 'FAST',
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    expect(repo.get()).toEqual({ mode: 'FAST', minDelayMs: 0, maxDelayMs: 0 });
  });

  it('persists a valid custom delay range', () => {
    repo.save({ mode: 'CUSTOM', minDelayMs: 1_500, maxDelayMs: 4_500 });
    expect(repo.get()).toEqual({ mode: 'CUSTOM', minDelayMs: 1_500, maxDelayMs: 4_500 });
  });

  it('rejects inverted or excessive delay ranges', () => {
    expect(() => repo.save({ mode: 'CUSTOM', minDelayMs: 5_000, maxDelayMs: 2_000 })).toThrow(
      'minimum no greater than maximum'
    );
    expect(() => repo.save({ mode: 'CUSTOM', minDelayMs: 0, maxDelayMs: 60_001 })).toThrow(
      'between 0 and 60 seconds'
    );
  });
});
