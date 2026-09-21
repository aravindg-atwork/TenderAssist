import { describe, it, expect } from 'vitest';
import { parseActiveTenderRow } from '../../src/search/activeTenderRowParser.js';

describe('parseActiveTenderRow', () => {
  // Real row captured live 2026-09-21 from an authenticated Search Active
  // Tenders results table (Information Technology category).
  const realCells = [
    '1.',
    '2026_EB_705493_1',
    'AMC for Open  Access Energy Adjustment and Accounting Software with presence of one Technical Person On-site for a period of Two Years ',
    'CE/IT and RAPDRP-11/2026-27',
    'Information Technology',
    'NA',
  ];

  it('parses a real captured row', () => {
    const result = parseActiveTenderRow(realCells);
    expect(result).toEqual({
      serialNo: '1.',
      tenderId: '2026_EB_705493_1',
      title: 'AMC for Open  Access Energy Adjustment and Accounting Software with presence of one Technical Person On-site for a period of Two Years',
      referenceNumber: 'CE/IT and RAPDRP-11/2026-27',
      productCategory: 'Information Technology',
      valueInRupees: 'NA',
    });
  });

  it('trims each cell', () => {
    const result = parseActiveTenderRow(['  1.  ', ' id ', ' title ', ' ref ', ' cat ', '  1,000  ']);
    expect(result).toEqual({
      serialNo: '1.',
      tenderId: 'id',
      title: 'title',
      referenceNumber: 'ref',
      productCategory: 'cat',
      valueInRupees: '1,000',
    });
  });

  it('returns null when there are fewer than 6 cells (e.g. the table footer row)', () => {
    expect(parseActiveTenderRow(['footer text'])).toBeNull();
  });

  it('returns null for an empty cells array', () => {
    expect(parseActiveTenderRow([])).toBeNull();
  });

  it('ignores any 7th+ cell (the Favorite checkbox column is handled separately, not parsed as text)', () => {
    const result = parseActiveTenderRow([...realCells, 'ignored favorite cell content']);
    expect(result?.valueInRupees).toBe('NA');
  });
});
