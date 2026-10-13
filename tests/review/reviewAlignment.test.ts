import { describe, expect, it } from 'vitest';
import { reviewForLifecycle } from '../../src/review/reviewAlignment.js';

describe('a run answer follows the operator’s later decision', () => {
  it('approved, and everything after approval, is KEEP', () => {
    for (const lifecycle of ['APPROVED', 'DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'PREPARING', 'SUBMITTED', 'WON', 'LOST'] as const) {
      expect(reviewForLifecycle(lifecycle)).toBe('KEEP');
    }
  });

  it('rejected is REJECT', () => {
    expect(reviewForLifecycle('REJECTED')).toBe('REJECT');
  });

  it('back to review or later clears the old answer', () => {
    for (const lifecycle of ['NEW', 'SCREENED', 'DEFERRED'] as const) expect(reviewForLifecycle(lifecycle)).toBeNull();
  });

  it('a closed or cancelled tender keeps its last decision', () => {
    expect(reviewForLifecycle('EXPIRED')).toBe('LEAVE');
    expect(reviewForLifecycle('CANCELLED')).toBe('LEAVE');
  });
});
