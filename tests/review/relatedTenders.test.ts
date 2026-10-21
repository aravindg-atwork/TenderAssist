import { describe, expect, it } from 'vitest';
import { possibleRetenderPairs, retenderReason, titleWords } from '../../src/review/relatedTenders.js';

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

describe('finding retender pairs among many tenders', () => {
  const titles = [
    'Design development and hosting of the district web portal',
    'Re-Tender - Design development and hosting of the district web portal (2nd Call)',
    'Supply installation and commissioning of CCTV cameras at the head office',
    'Supply installation and commissioning of CCTV cameras at the head office building',
    'Supply of computers',
  ];
  const rows = Array.from({ length: 60 }, (_, index) => ({ id: `opp-${index}`, ...tender({
    identity_key: `2026_ELCO_${index}_1`,
    tender_ref: index % 7 === 0 ? 'ELCOT/IT/7/2026' : index % 11 === 0 ? 'NA' : `ELCOT/IT/${100 + index}/2026`,
    title: titles[index % titles.length],
    department: index % 3 === 0 ? null : ['ELCOT', 'PWD'][index % 2],
    organisation_chain: index % 4 === 0 ? 'ELCOT||IT Wing' : null,
    portal_id: index % 13 === 0 ? 'kerala' : 'tamil-nadu',
  }) }));
  const pairKey = (a: { id: string }, b: { id: string }) => [a.id, b.id].sort().join('|');
  const everyPair = (focus: string[]) => {
    const keys = new Set<string>();
    for (const id of focus) {
      const current = rows.find((row) => row.id === id)!;
      for (const other of rows) if (other !== current && retenderReason(current, other)) keys.add(pairKey(current, other));
    }
    return [...keys].sort();
  };

  it('finds exactly the pairs that comparing every tender with every other finds, each once', () => {
    const all = rows.map((row) => row.id);
    expect(everyPair(all).length).toBeGreaterThan(20);
    for (const focus of [all, all.slice(0, 9), ['opp-14', 'opp-1', 'opp-14']]) {
      const found = possibleRetenderPairs(rows, focus).map(([a, b]) => pairKey(a, b));
      expect(found.length).toBe(new Set(found).size);
      expect(found.sort()).toEqual(everyPair(focus));
    }
  });
});
