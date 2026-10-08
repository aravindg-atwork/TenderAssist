import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_STRUCTURE, normalizeOutputStructure, PREVIOUS_MONTH_FOLDER_TEMPLATE, resolveOutputStructure } from '../../src/publishing/outputStructure.js';

describe('month folder names', () => {
  it('names the month folder October-2026 by default', () => {
    expect(resolveOutputStructure(DEFAULT_OUTPUT_STRUCTURE, '2026-10-08').monthFolder).toBe('October-2026');
    expect(resolveOutputStructure(DEFAULT_OUTPUT_STRUCTURE, '2026-01-31').monthFolder).toBe('January-2026');
  });

  it('keeps day and tender folders in numbers', () => {
    const resolved = resolveOutputStructure(DEFAULT_OUTPUT_STRUCTURE, '2026-10-08', 'Web portal', 3);
    expect(resolved.dayFolder).toBe('08-10-2026');
    expect(resolved.tenderFolder).toBe('08-10-2026_3_Web portal');
  });

  it('still resolves runs saved with the old numbered month', () => {
    const old = normalizeOutputStructure({ ...DEFAULT_OUTPUT_STRUCTURE, monthFolderTemplate: PREVIOUS_MONTH_FOLDER_TEMPLATE });
    expect(resolveOutputStructure(old, '2026-10-08').monthFolder).toBe('10-2026');
  });
});
