import { describe, it, expect } from 'vitest';
import { evaluateGate2 } from '../../src/classification/gate2ProductCategory.js';

describe('evaluateGate2', () => {
  it('passes on an exact match', () => {
    const result = evaluateGate2('Computer- S/W', 'Computer- S/W');
    expect(result).toEqual({
      gate: 'G2',
      result: 'PASS',
      reason_code: 'PRODUCT_CATEGORY_MATCH',
      product_category: 'Computer- S/W',
    });
  });

  it('passes on a case-insensitive match', () => {
    const result = evaluateGate2('computer- s/w', 'Computer- S/W');
    expect(result.result).toBe('PASS');
  });

  it('rejects a mismatch', () => {
    const result = evaluateGate2('Miscellaneous Goods', 'Computer- S/W');
    expect(result.result).toBe('REJECT');
    expect(result.reason_code).toBe('PRODUCT_CATEGORY_MISMATCH');
  });
});
