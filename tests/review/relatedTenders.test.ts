import { describe, expect, it } from 'vitest';
import { retenderReason, titleWords } from '../../src/review/relatedTenders.js';

const tender = (overrides: Partial<Parameters<typeof retenderReason>[0]> = {}) => ({
  portal_id: 'tamil-nadu',
  identity_key: '2026_ELCO_1_1',
  tender_ref: 'ELCOT/IT/7/2026',
  title: 'Design development and hosting of the district web portal',
  department: 'ELCOT',
  organisation_chain: 'ELCOT||IT Wing',
  ...overrides,
});

describe('retender matching', () => {
  it('matches a new Tender ID with the same reference number', () => {
    expect(retenderReason(tender(), tender({ identity_key: '2026_ELCO_2_1', title: 'Something else', department: null }))).toBe('SAME_REFERENCE');
  });

  it('matches a near-identical title from the same department, ignoring retender wording', () => {
    const retender = tender({ identity_key: '2026_ELCO_2_1', tender_ref: 'ELCOT/IT/9/2026', title: 'Re-Tender - Design development and hosting of the district web portal (2nd Call)' });
    expect(retenderReason(tender(), retender)).toBe('SIMILAR_TITLE');
  });

  it('does not match the same Tender ID, another portal, another department, or short generic titles', () => {
    expect(retenderReason(tender(), tender())).toBeNull();
    expect(retenderReason(tender(), tender({ identity_key: 'X', portal_id: 'kerala' }))).toBeNull();
    expect(retenderReason(tender(), tender({ identity_key: 'X', tender_ref: 'OTHER/1', department: 'PWD', organisation_chain: 'PWD' }))).toBeNull();
    expect(retenderReason(
      tender({ title: 'Supply of computers' }),
      tender({ identity_key: 'X', tender_ref: 'OTHER/1', title: 'Supply of computers' }),
    )).toBeNull();
  });

  it('ignores placeholder references', () => {
    expect(retenderReason(tender({ tender_ref: 'NA', title: 'a' }), tender({ identity_key: 'X', tender_ref: 'NA', title: 'b' }))).toBeNull();
  });

  it('strips retender words from titles', () => {
    expect([...titleWords('Retender call no. 3 for CCTV installation')]).toEqual(['for', 'cctv', 'installation']);
  });
});
