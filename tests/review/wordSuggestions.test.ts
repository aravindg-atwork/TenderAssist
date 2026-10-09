import { describe, expect, it } from 'vitest';
import { suggestWords, workDescriptionFrom, workPartOfTitle } from '../../src/review/wordSuggestions.js';

const tender = (title: string, description: string | null = null) => ({ title, description });

describe('suggestWords', () => {
  const approved = [
    tender('Design of e-Governance web portal for District Collectorate'),
    tender('Development of e-Governance mobile app', 'Build and host an e-Governance platform'),
    tender('e-Governance dashboard for Revenue Department'),
    tender('Citizen e-Governance grievance software'),
  ];
  const rejected = [
    tender('Supply of CCTV cameras for police station'),
    tender('Installation of CCTV cameras at bus stand'),
    tender('CCTV cameras annual maintenance'),
    tender('Purchase of e-Governance kiosks'),
  ];

  it('suggests phrases common in approved tenders and rare in rejected ones, with the reason', () => {
    const result = suggestWords({ approved, rejected, keywords: [], excludedKeywords: [] });
    expect(result.intent[0]).toEqual({ phrase: 'governance', approved: 4, rejected: 1, reason: 'in 4 approved, 1 rejected' });
  });

  it('suggests excluded words from rejected titles', () => {
    const result = suggestWords({ approved, rejected, keywords: [], excludedKeywords: [] });
    expect(result.excluded.map((item) => item.phrase)).toContain('cctv cameras');
    // "cctv" alone appears only as part of "cctv cameras", so it is not offered twice.
    expect(result.excluded.map((item) => item.phrase)).not.toContain('cctv');
    expect(result.excluded[0].reason).toBe('in 3 rejected titles, 0 approved');
  });

  it('does not suggest words the operator already has', () => {
    const result = suggestWords({ approved, rejected, keywords: ['e-Governance'], excludedKeywords: ['CCTV'] });
    expect(result.intent.map((item) => item.phrase)).not.toContain('governance');
    expect(result.excluded.map((item) => item.phrase)).not.toContain('cctv cameras');
  });

  it('needs at least three tenders before suggesting anything', () => {
    const result = suggestWords({ approved: approved.slice(0, 2), rejected: [], keywords: [], excludedKeywords: [] });
    expect(result.intent).toEqual([]);
  });
});

describe('workDescriptionFrom', () => {
  it('reads the Work Description field from the saved detail text', () => {
    expect(workDescriptionFrom('Tender ID: 1\nWork Description: Build a web portal\n\nbody')).toBe('Build a web portal');
    expect(workDescriptionFrom('Tender ID: 1')).toBeNull();
    expect(workDescriptionFrom(null)).toBeNull();
  });

  it('ignores GeM form wording in bid titles and suggests the work instead', () => {
    const gem = (work: string) => ({ title: `Custom Bid for Services - Repair and Overhauling Service - ${work}; ANGAD; Yes; Buyer Premises`, description: null });
    const result = suggestWords({
      approved: [{ title: 'Custom Bid for Services - Mobile app development; Yes; Service Provider Premises', description: null }],
      rejected: [gem('WASHING RIG'), gem('BARE SHELTER'), gem('built up trucks'), gem('CRANE')],
      keywords: [], excludedKeywords: [],
    });
    const phrases = result.excluded.map((item) => item.phrase);
    expect(phrases).toContain('repair and overhauling');
    for (const noise of ['custom', 'premises', 'yes', 'buyer', 'buyer premises', 'service provider premises', 'angad']) expect(phrases).not.toContain(noise);
  });

  it('keeps only the work part of a GeM title', () => {
    expect(workPartOfTitle('Custom Bid for Services - Handling Service, Transport Service; Yes; Buyer Premises')).toBe('Handling Service, Transport Service');
    expect(workPartOfTitle('Construction of compound wall')).toBe('Construction of compound wall');
  });
});
