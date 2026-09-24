import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { PublishingSettingsRepository } from '../../../src/persistence/repositories/publishingSettingsRepository.js';
import { DEFAULT_OUTPUT_STRUCTURE } from '../../../src/publishing/outputStructure.js';

describe('PublishingSettingsRepository', () => {
  let repo: PublishingSettingsRepository;

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new PublishingSettingsRepository(db, 'C:\\TenderAssist');
  });

  it('keeps local and Drive paths isolated per portal', () => {
    repo.save({ localOutputRoot: 'D:\\TN', driveOutputRoot: 'G:\\TN', structure: DEFAULT_OUTPUT_STRUCTURE }, 'tamil-nadu');
    repo.save({ localOutputRoot: 'D:\\Kerala', driveOutputRoot: '', structure: DEFAULT_OUTPUT_STRUCTURE }, 'kerala');
    expect(repo.get('tamil-nadu')).toEqual({ localOutputRoot: 'D:\\TN', driveOutputRoot: 'G:\\TN', structure: DEFAULT_OUTPUT_STRUCTURE });
    expect(repo.get('kerala')).toEqual({ localOutputRoot: 'D:\\Kerala', driveOutputRoot: '', structure: DEFAULT_OUTPUT_STRUCTURE });
  });

  it('stores safe custom naming templates and requires a serial-number token', () => {
    const structure = { ...DEFAULT_OUTPUT_STRUCTURE, monthFolderTemplate: '{YYYY}-{MM}', tenderFolderTemplate: '{SNO} - {TITLE}' };
    expect(repo.save({ localOutputRoot: 'D:\\TN', driveOutputRoot: '', structure }).structure).toEqual(structure);
    expect(() => repo.save({
      localOutputRoot: 'D:\\TN', driveOutputRoot: '',
      structure: { ...structure, tenderFolderTemplate: '{TITLE}' },
    })).toThrow(/must include \{SNO\}/);
  });
});
