import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_DEFAULTS, type RunDefaults } from '../../src/config/runConfiguration.js';
import { explainMissedTenders, whyMissed, type MissedTender } from '../../src/review/missedTenders.js';
import type { ScreenedGate } from '../../src/review/tenderExplanation.js';

const defaults: RunDefaults = {
  ...DEFAULT_RUN_DEFAULTS,
  keywords: ['software development', 'website development'],
  excludedKeywords: ['printer', 'CCTV'],
  categoriesByPortal: { 'tamil-nadu': ['Computer- S/W', 'Information Technology'] },
};

const pass = (gate: ScreenedGate['gate']): ScreenedGate => ({ gate, result: 'PASS', reasonCode: 'OK', evidence: {} });
const noIntent: ScreenedGate = { gate: 'G3', result: 'REJECT', reasonCode: 'NO_INTENT_KEYWORD_MATCH', evidence: { matchedKeywords: [] } };
const outsideCategory = (actual: string): ScreenedGate => ({ gate: 'G2', result: 'REJECT', reasonCode: 'PRODUCT_CATEGORY_MISMATCH', evidence: { actual, matched: [] } });

function missed(title: string, gates: ScreenedGate[], extra: Partial<MissedTender> = {}): MissedTender {
  return {
    portalId: 'tamil-nadu', portalName: 'Tamil Nadu', title, workDescription: null, details: '', organisation: null,
    gates, addedByHand: true, jobId: 'job-1', approvedAt: '2026-10-27T05:00:00Z', ...extra,
  };
}

const now = new Date('2026-10-27T12:00:00Z');

describe('whyMissed', () => {
  it('names the category and organisation when the category is not chosen', () => {
    const reasons = whyMissed(missed('Supply of Desktop Computers', [pass('G1'), { ...outsideCategory('x'), evidence: { actual: ['Computer- H/W'] } }, pass('G3'), pass('G4')],
      { organisation: 'Tamil Nadu Skill Development Corporation||Head Office' }), defaults);
    expect(reasons.category).toBe('Computer- H/W');
    expect(reasons.organisation).toBe('Tamil Nadu Skill Development Corporation');
  });

  it('does not offer a fix the operator has made since', () => {
    const tender = missed('Design, Development and Maintenance of Web Portal for TNSDC', [pass('G2'), noIntent, pass('G4')]);
    expect(whyMissed(tender, defaults).noIntentWord).toBe(true);
    expect(whyMissed(tender, { ...defaults, keywords: [...defaults.keywords, 'web portal'] }).noIntentWord).toBe(false);
  });

  it('a chosen organisation counts as a chosen category', () => {
    const tender = missed('Web portal', [{ gate: 'G2', result: 'REJECT', reasonCode: 'PRODUCT_CATEGORY_MISMATCH', evidence: { actual: ['Works'] } }],
      { organisation: 'Greater Chennai Corporation' });
    expect(whyMissed(tender, { ...defaults, organisationsByPortal: { 'tamil-nadu': ['Greater Chennai Corporation'] } }).category).toBeNull();
  });

  it('names the excluded words that still reject it', () => {
    const tender = missed('Supply and Installation of CCTV based Smart Classroom Software', [pass('G2'), pass('G3'),
      { gate: 'G4', result: 'REJECT', reasonCode: 'EXCLUDED_PRIMARY_SCOPE', evidence: { matchedExcludedKeywords: ['CCTV'], evaluatedText: 'Supply and Installation of CCTV based Smart Classroom Software' } }]);
    expect(whyMissed(tender, defaults).excludedWords).toEqual(['CCTV']);
    expect(whyMissed(tender, { ...defaults, excludedKeywords: [] }).excludedWords).toEqual([]);
  });
});

describe('explainMissedTenders', () => {
  it('proposes the phrase in both missed titles, with a plain reason', () => {
    const view = explainMissedTenders([
      missed('Design, Development and Maintenance of Web Portal for TNSDC', [pass('G2'), noIntent, pass('G4')]),
      missed('Web Portal for Tamil Nadu e-Sevai Centres', [pass('G2'), noIntent, pass('G4')]),
    ], defaults, { now });
    expect(view.missed).toBe(2);
    expect(view.suggestions[0]).toMatchObject({
      fix: { kind: 'ADD_INTENT_WORD', phrase: 'web portal' },
      reason: 'Missed 2 tenders you wanted: “web portal” was in both titles.',
      tenders: 2,
    });
    // One phrase covers both: nothing more is needed.
    expect(view.suggestions.filter((item) => item.fix.kind === 'ADD_INTENT_WORD')).toHaveLength(1);
  });

  it('covers each missed tender with its own best phrase', () => {
    const view = explainMissedTenders([
      missed('Design, Development and Maintenance of Web Portal for TNSDC', [noIntent]),
      missed('Development of Android Mobile Application for Greater Chennai Corporation', [noIntent]),
    ], defaults, { now });
    expect(view.suggestions.map((item) => item.fix.kind === 'ADD_INTENT_WORD' && item.fix.phrase)).toEqual(['mobile application', 'web portal']);
    expect(view.suggestions[0].reason).toBe('Missed 1 tender you wanted: “mobile application” was in its title.');
  });

  it('suggests the category for the website, and the organisation, most frequent first', () => {
    const gates = [{ gate: 'G2', result: 'REJECT', reasonCode: 'PRODUCT_CATEGORY_MISMATCH', evidence: { actual: ['Consultancy'] } } as ScreenedGate];
    const view = explainMissedTenders([
      missed('Website development for TNeGA', gates, { organisation: 'Tamil Nadu e-Governance Agency' }),
      missed('Software development for TNeGA', gates, { organisation: 'Tamil Nadu e-Governance Agency' }),
      missed('Supply of CCTV Cameras with Software Development', [pass('G2'), pass('G3'),
        { gate: 'G4', result: 'REJECT', reasonCode: 'EXCLUDED_PRIMARY_SCOPE', evidence: { evaluatedText: 'Supply of CCTV Cameras with Software Development' } }]),
    ], defaults, { now });
    expect(view.suggestions.map((item) => item.label)).toEqual([
      'Add category “Consultancy” for Tamil Nadu',
      'Add organisation “Tamil Nadu e-Governance Agency”',
      'Excluded word “CCTV” rejected a tender you wanted; remove it, or keep it?',
    ]);
    expect(view.suggestions[0].reason).toBe('Missed 2 tenders you wanted: they were in “Consultancy”, which is not one of your categories.');
    expect(view.suggestions[0].fix).toEqual({ kind: 'ADD_CATEGORY', portalId: 'tamil-nadu', category: 'Consultancy' });
  });

  it('notes an AMC phrase, and leaves out tenders older than 60 days', () => {
    const view = explainMissedTenders([
      missed('Annual Maintenance of Software AMC for Treasury', [noIntent]),
      missed('Development of Web Portal', [noIntent], { approvedAt: '2026-08-01T00:00:00Z' }),
    ], { ...defaults, excludedKeywords: ['AMC'] }, { now });
    expect(view.missed).toBe(1);
    const amc = view.suggestions.find((item) => item.fix.kind === 'ADD_INTENT_WORD' && item.fix.phrase === 'software amc');
    expect(amc?.note).toMatch(/excluded word “AMC”/);
  });

  it('counts the tenders the latest run read that the operator added by hand', () => {
    const view = explainMissedTenders([
      missed('Web Portal for TNSDC', [noIntent], { jobId: 'job-2', approvedAt: '2026-10-27T06:00:00Z' }),
      missed('Website development for TNSDC', [pass('G2'), pass('G3'), pass('G4')], { jobId: 'job-2', approvedAt: '2026-10-27T06:01:00Z' }),
      missed('Mobile app for GCC', [noIntent], { jobId: 'job-1', approvedAt: '2026-10-26T06:00:00Z' }),
      missed('E-learning for Anna University', [noIntent], { jobId: 'job-3', addedByHand: false, approvedAt: '2026-10-27T09:00:00Z' }),
    ], defaults, { now });
    expect(view.latestRun).toEqual({ jobId: 'job-2', addedByHand: 2, missed: 1 });
  });

  it('has nothing to say when the rules would keep every wanted tender', () => {
    const view = explainMissedTenders([missed('Website development for TNSDC', [pass('G2'), pass('G3'), pass('G4')], { addedByHand: false })], defaults, { now });
    expect(view).toEqual({ missed: 0, suggestions: [], latestRun: null });
  });
});
