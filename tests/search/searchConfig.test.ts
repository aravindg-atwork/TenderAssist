import { describe, it, expect } from 'vitest';
import { CONFIGURED_SEARCHES } from '../../src/search/searchConfig.js';

describe('CONFIGURED_SEARCHES', () => {
  it('has exactly the 7 real production category searches, confirmed live 2026-09-21', () => {
    const categories = CONFIGURED_SEARCHES.map((s) => s.productCategory);
    expect(categories).toEqual([
      'Computer- S/W',
      'Information Technology',
      'Info. Tech. Services',
      'Documentary film,Video film',
      'Miscellaneous Goods',
      'Miscellaneous Services',
      'Miscellaneous Works',
    ]);
  });

  it('never includes Computer- H/W (hardware is explicitly out of scope)', () => {
    expect(CONFIGURED_SEARCHES.map((s) => s.productCategory)).not.toContain('Computer- H/W');
  });

  it('every search key is unique', () => {
    const keys = CONFIGURED_SEARCHES.map((s) => s.searchKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
