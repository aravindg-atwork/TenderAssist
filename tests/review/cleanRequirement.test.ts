import { describe, expect, it } from 'vitest';
import { cleanRequirement } from '../../src/review/tenderFile.js';

describe('cleanRequirement', () => {
  it('drops what the reader wrongly picked from long documents (seen 9 Oct 2026)', () => {
    expect(cleanRequirement('emd', 'Detail')).toBeNull();
    expect(cleanRequirement('tenderFee', '/ Bid Participation fee, as the case may be')).toBeNull();
    expect(cleanRequirement('contact', '..................................................')).toBeNull();
    expect(cleanRequirement('scope', 'Yes')).toBeNull();
  });

  it('keeps real answers', () => {
    expect(cleanRequirement('emd', 'Rs. 25,000')).toBe('Rs. 25,000');
    expect(cleanRequirement('emd', 'Exempted for MSEs')).toBe('Exempted for MSEs');
    expect(cleanRequirement('contact', 'cpo@bhel.in, 080-2219 5555')).toBe('cpo@bhel.in, 080-2219 5555');
    expect(cleanRequirement('eligibility', 'MSE relaxation: No; startup relaxation: No')).toBe('MSE relaxation: No; startup relaxation: No');
    expect(cleanRequirement('submissionDeadline', '17-10-2026 10:00:00')).toBe('17-10-2026 10:00:00');
  });
});
