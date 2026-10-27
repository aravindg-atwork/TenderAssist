import { describe, expect, it } from 'vitest';
import {
  bandOf, buildInterestHistory, buyerKey, fitLabel, INTEREST_WEIGHTS, InterestHistoryCache, interestScore, rupeesOf, tenderInterest,
  type ApprovedTender, type InterestSignals, type TenderInterestInput,
} from '../../src/review/interestScore.js';
import type { ScreenedGate } from '../../src/review/tenderExplanation.js';
import type { QualifyReport } from '../../src/review/qualifyCheck.js';

const NOW = new Date('2026-10-27T10:00:00+05:30');
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();
const gate = (id: ScreenedGate['gate'], result: ScreenedGate['result'], reasonCode: string, evidence: Record<string, unknown> = {}): ScreenedGate =>
  ({ gate: id, result, reasonCode, evidence });

const NOTHING: InterestSignals = {
  intentInTitle: [], intentOnlyInDetails: [], category: null, organisation: null, excludedInTitle: [], excludedInDetails: [],
  similarity: null, qualify: null, daysLeft: null, value: null, usualValues: null, buyer: null,
};

const tender = (overrides: Partial<TenderInterestInput> = {}): TenderInterestInput => ({
  id: 'new-1',
  title: 'Design and Development of Official Website for Tamil Nadu Fisheries Department',
  gates: [
    gate('G2', 'PASS', 'PRODUCT_CATEGORY_MATCH', { matched: ['Information Technology'] }),
    gate('G3', 'PASS', 'INTENT_KEYWORD_MATCH', { matchedKeywords: ['website'] }),
    gate('G4', 'PASS', 'NO_EXCLUDED_PRIMARY_SCOPE', { matchedExcludedKeywords: [] }),
  ],
  organisation: 'Fisheries Department||Commissionerate of Fisheries',
  department: null,
  closingAt: inDays(14),
  value: '1500000',
  ...overrides,
});

const approved = (id: string, title: string, overrides: Partial<ApprovedTender> = {}): ApprovedTender => ({
  id, title, lifecycle: 'APPROVED', organisation: 'Commissionerate of Revenue Administration', department: null, value: null, ...overrides,
});

const qualify = (met: number, notMet: number, toCheck = 0, profileFilled = true): QualifyReport => ({
  checks: Array.from({ length: met + notMet + toCheck }, () => ({}) as QualifyReport['checks'][number]), met, notMet, toCheck, profileFilled,
});

describe('interest score', () => {
  it('bands at 70 and 40', () => {
    expect([bandOf(70), bandOf(69), bandOf(40), bandOf(39)]).toEqual(['HIGH', 'MEDIUM', 'MEDIUM', 'LOW']);
    expect(fitLabel({ score: 82, band: 'HIGH' })).toBe('High (82)');
  });

  it('makes your words in the title and your category High, only in the details Medium, none Low', () => {
    const title = interestScore({ ...NOTHING, intentInTitle: ['website'], category: 'Information Technology' });
    expect(title).toMatchObject({ score: 70, band: 'HIGH' });
    expect(title.reasons).toEqual([
      { text: 'Your words in the title: “website”', points: INTEREST_WEIGHTS.INTENT_IN_TITLE },
      { text: 'In your category “Information Technology”', points: INTEREST_WEIGHTS.IN_CATEGORY },
    ]);
    expect(interestScore({ ...NOTHING, intentOnlyInDetails: ['mobile application'], category: 'Information Technology' }).band).toBe('MEDIUM');
    const none = interestScore({ ...NOTHING, category: 'Information Technology' });
    expect(none.band).toBe('LOW');
    expect(none.reasons[0]).toEqual({ text: 'None of your words in it', points: 0 });
  });

  it('takes a lot away for an excluded word in the title, less for one in the details', () => {
    const base = { ...NOTHING, intentInTitle: ['website'], category: 'Information Technology' };
    expect(interestScore({ ...base, excludedInTitle: ['AMC'] })).toMatchObject({ score: 35, band: 'LOW' });
    expect(interestScore({ ...base, excludedInDetails: ['AMC'] }).score).toBe(60);
  });

  it('counts "Do we qualify?" only once the company facts are filled in', () => {
    const base = { ...NOTHING, intentInTitle: ['portal'] };
    expect(interestScore({ ...base, qualify: qualify(5, 0) }).reasons.at(-1)).toEqual({ text: 'You meet its criteria', points: 10 });
    expect(interestScore({ ...base, qualify: qualify(3, 2) }).reasons.at(-1)).toEqual({ text: 'You may not meet 2 of 5 criteria', points: -15 });
    expect(interestScore({ ...base, qualify: qualify(3, 0, 2) }).reasons.at(-1)?.text).toBe('You meet 3 criteria; 2 to check');
    expect(interestScore({ ...base, qualify: qualify(0, 0, 4) }).score).toBe(60);
    expect(interestScore({ ...base, qualify: qualify(0, 3, 0, false) }).score).toBe(60);
  });

  it('marks down a tender that leaves too few days to prepare', () => {
    const base = { ...NOTHING, intentInTitle: ['portal'] };
    expect(interestScore({ ...base, daysLeft: 0.5 }).reasons.at(-1)).toEqual({ text: 'Closes within a day', points: -20 });
    expect(interestScore({ ...base, daysLeft: 1.5 }).reasons.at(-1)?.text).toBe('Only 1 day left to prepare');
    expect(interestScore({ ...base, daysLeft: 3.2 }).reasons.at(-1)).toEqual({ text: 'Only 3 days left to prepare', points: -8 });
    expect(interestScore({ ...base, daysLeft: 12 }).score).toBe(60);
  });

  it('never goes below 0 or above 100', () => {
    expect(interestScore({ ...NOTHING, excludedInTitle: ['hardware'], daysLeft: -1, qualify: qualify(0, 4) }).score).toBe(0);
    expect(interestScore({
      ...NOTHING, intentInTitle: ['website'], category: 'IT', organisation: 'ELCOT', qualify: qualify(4, 0),
      similarity: { best: 0.9, similar: [{ id: 'a', title: 'Website', similarity: 0.9 }] }, buyer: { approved: 3, won: 1 },
    }).score).toBe(100);
  });
});

describe('a tender scored from its screening and the office history', () => {
  const history = buildInterestHistory([
    approved('a1', 'Development and Maintenance of Website for Department of Fisheries', { organisation: 'Fisheries Department||Commissionerate of Fisheries', lifecycle: 'WON', value: '12,00,000.00' }),
    approved('a2', 'Development of Mobile Application for Public Distribution System', { value: '25,00,000' }),
    approved('a3', 'Custom Bid for Services - Learning Management System for Police Training College', { value: '18,00,000' }),
    approved('a4', 'Design of Web Portal for Tamil Nadu e-Governance Agency', { value: '9,50,000' }),
    approved('a5', 'Revamp of District Website, Madurai', { value: '4,00,000' }),
  ]);

  it('says what it looks like and that the office won from this buyer', () => {
    const fit = tenderInterest(tender(), history, NOW);
    expect(fit.similarTo[0]).toMatchObject({ id: 'a1', title: 'Development and Maintenance of Website for Department of Fisheries' });
    expect(fit.reasons.map((reason) => reason.text)).toEqual([
      'Your words in the title: “website”',
      'In your category “Information Technology”',
      'Looks like “Development and Maintenance of Website for Department of Fisheries”, which you approved',
      'Value in your usual range',
      'You won a tender from this buyer before',
    ]);
    expect(fit.band).toBe('HIGH');
  });

  it('reads search words, details-only words and excluded words from the gates', () => {
    const gem = tenderInterest(tender({
      title: 'Custom Bid for Services - Hiring of Agency for Annual Maintenance of Computers',
      organisation: 'Ministry of Defence||Department of Military Affairs',
      gates: [
        gate('G2', 'PASS', 'SEARCH_WORD_MATCH', { searchWords: ['LMS'] }),
        gate('G3', 'PASS', 'SEARCH_WORD_IN_DOCUMENT', { searchWords: ['LMS'], matchedKeywords: [] }),
        gate('G4', 'REJECT', 'EXCLUDED_PRIMARY_SCOPE', { matchedExcludedKeywords: ['annual maintenance'] }),
      ],
    }), history, NOW);
    expect(gem.reasons.slice(0, 2)).toEqual([
      { text: 'Your words only in its details: “LMS”', points: 15 },
      { text: 'Excluded word in the title: “annual maintenance”', points: -35 },
    ]);
    expect(gem.band).toBe('LOW');
  });

  it('counts the work description as title text, and a chosen organisation', () => {
    const fit = tenderInterest(tender({
      title: 'Tender for IT Works',
      description: 'Development of mobile app for Greater Chennai Corporation',
      gates: [gate('G3', 'PASS', 'INTENT_KEYWORD_MATCH', { matchedKeywords: ['mobile app'] })],
      favouredOrganisation: 'Greater Chennai Corporation',
      organisation: 'Greater Chennai Corporation||IT Cell',
    }), null, NOW);
    expect(fit.reasons.slice(0, 2)).toEqual([
      { text: 'Your words in the title: “mobile app”', points: 35 },
      { text: 'From your organisation “Greater Chennai Corporation”', points: 15 },
    ]);
  });

  it('never counts an approved tender as its own history', () => {
    const own = tenderInterest(tender({ id: 'a1', title: 'Development and Maintenance of Website for Department of Fisheries' }), history, NOW);
    expect(own.similarTo.map((match) => match.id)).not.toContain('a1');
    expect(own.reasons.map((reason) => reason.text).filter((text) => text.includes('buyer'))).toEqual([]);
  });

  it('works without any history, and without a closing time', () => {
    const fit = tenderInterest(tender({ closingAt: null }), null, NOW);
    expect(fit).toMatchObject({ score: 70, band: 'HIGH', similarTo: [] });
  });

  it('flags a value far outside the usual range, and skips the range with too few values', () => {
    const big = tenderInterest(tender({ value: '50000000' }), history, NOW);
    expect(big.reasons.map((reason) => reason.text)).toContain('Much larger than the tenders you usually approve');
    const thin = buildInterestHistory([approved('x', 'Website', { value: '100000' })]);
    expect(thin.usualValues).toBeNull();
  });
});

describe('office history', () => {
  it('knows the same buyer whatever the case and punctuation', () => {
    expect(buyerKey('Tamil Nadu e-Governance Agency||IT', null)).toBe(buyerKey('TAMIL NADU E GOVERNANCE AGENCY || IT', ''));
    expect(buyerKey(null, null)).toBe('');
  });

  it('reads rupees as the websites store them', () => {
    expect(rupeesOf('1,50,000.00')).toBe(150000);
    expect(rupeesOf('₹ 25,00,000')).toBe(2500000);
    expect(rupeesOf('Rs. 4000')).toBe(4000);
    expect(rupeesOf('NA')).toBeNull();
    expect(rupeesOf('')).toBeNull();
    expect(rupeesOf('0.00')).toBeNull();
  });

  it('builds the history again only when the approved tenders change', () => {
    const cache = new InterestHistoryCache();
    let builds = 0;
    const rows = [{ id: 'a1', lifecycle: 'APPROVED', updated_at: '2026-10-20' }];
    const load = () => { builds += 1; return [approved('a1', 'Website for District Collectorate')]; };
    const first = cache.get(rows, load);
    expect(cache.get([...rows], load)).toBe(first);
    expect(builds).toBe(1);
    cache.get([{ ...rows[0], lifecycle: 'WON' }], load);
    expect(builds).toBe(2);
  });
});
