import { describe, it, expect } from 'vitest';
import { evaluateGate1 } from '../../src/classification/gate1Freshness.js';

describe('evaluateGate1', () => {
  it('passes when the published date is within the freshness window', () => {
    const result = evaluateGate1('2026-09-11T18:00:00+05:30', '2026-09-15T00:00:00+05:30', 7);
    expect(result).toEqual({
      gate: 'G1',
      result: 'PASS',
      reason_code: 'WITHIN_FRESHNESS_WINDOW',
      published_date: '2026-09-11T18:00:00+05:30',
      evaluated_against: '2026-09-15T00:00:00+05:30',
    });
  });

  it('rejects when the published date is outside the freshness window', () => {
    const result = evaluateGate1('2026-09-01T00:00:00+05:30', '2026-09-15T00:00:00+05:30', 7);
    expect(result.result).toBe('REJECT');
    expect(result.reason_code).toBe('OUTSIDE_FRESHNESS_WINDOW');
  });

  it('rejects with UNPARSEABLE_PUBLISHED_DATE when the published date is null', () => {
    const result = evaluateGate1(null, '2026-09-15T00:00:00+05:30', 7);
    expect(result.result).toBe('REJECT');
    expect(result.reason_code).toBe('UNPARSEABLE_PUBLISHED_DATE');
    expect(result.published_date).toBeNull();
  });

  it('rejects a published date that is after the evaluation date', () => {
    const result = evaluateGate1('2026-09-20T00:00:00+05:30', '2026-09-15T00:00:00+05:30', 7);
    expect(result.result).toBe('REJECT');
    expect(result.reason_code).toBe('OUTSIDE_FRESHNESS_WINDOW');
  });

  it('passes exactly at the boundary of the freshness window', () => {
    const result = evaluateGate1('2026-09-08T00:00:00+05:30', '2026-09-15T00:00:00+05:30', 7);
    expect(result.result).toBe('PASS');
  });
});
