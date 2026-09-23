import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { PublishingSettingsRepository } from '../../../src/persistence/repositories/publishingSettingsRepository.js';

describe('PublishingSettingsRepository', () => {
  let repo: PublishingSettingsRepository;

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new PublishingSettingsRepository(db, 'C:\\TenderAssist');
  });

  it('keeps local and Drive paths isolated per portal', () => {
    repo.save({ localOutputRoot: 'D:\\TN', driveOutputRoot: 'G:\\TN' }, 'tamil-nadu');
    repo.save({ localOutputRoot: 'D:\\Kerala', driveOutputRoot: '' }, 'kerala');
    expect(repo.get('tamil-nadu')).toEqual({ localOutputRoot: 'D:\\TN', driveOutputRoot: 'G:\\TN' });
    expect(repo.get('kerala')).toEqual({ localOutputRoot: 'D:\\Kerala', driveOutputRoot: '' });
  });
});
