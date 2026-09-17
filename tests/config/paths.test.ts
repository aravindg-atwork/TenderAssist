// tests/config/paths.test.ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { getAppDataDir, getDatabasePath } from '../../src/config/paths.js';

describe('paths', () => {
  it('uses APPDATA when set', () => {
    const dir = getAppDataDir({ APPDATA: 'C:\\Users\\Admin\\AppData\\Roaming' } as NodeJS.ProcessEnv);
    expect(dir).toBe(join('C:\\Users\\Admin\\AppData\\Roaming', 'TenderAssist'));
  });

  it('falls back to a home config dir when APPDATA is unset', () => {
    const dir = getAppDataDir({} as NodeJS.ProcessEnv);
    expect(dir.endsWith(join('.config', 'TenderAssist'))).toBe(true);
  });

  it('appends the database filename to the app data dir', () => {
    const dbPath = getDatabasePath({ APPDATA: 'C:\\AppData' } as NodeJS.ProcessEnv);
    expect(dbPath).toBe(join('C:\\AppData', 'TenderAssist', 'tenderassist.db'));
  });
});
