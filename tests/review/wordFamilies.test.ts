import { describe, expect, it } from 'vitest';
import { conflictNote, STARTER_FAMILIES, suggestFamilyWords } from '../../src/review/wordFamilies.js';

const tender = (title: string, description: string | null = null) => ({ title, description });

describe('suggestFamilyWords', () => {
  const approved = [
    tender('Design, Development and Maintenance of Web Portal for TNSDC'),
    tender('Development of e-Governance Portal for Revenue Department'),
    tender('Revamping of Official Website and e-Governance Portal of Tamil Nadu Housing Board'),
    tender('Development of Android Mobile Application for Greater Chennai Corporation'),
  ];

  it('suggests phrases that share the family’s work word, from tenders the operator approved', () => {
    const result = suggestFamilyWords({
      families: [{ name: 'Websites', phrases: ['web portal'] }],
      keywords: ['web portal'],
      excludedKeywords: [],
      approved,
    });
    const websites = result.byFamily.Websites;
    expect(websites[0]).toEqual({ phrase: 'e-governance portal', reason: 'in 2 tenders you approved' });
    // Already an intent word, or holds one: not offered.
    expect(websites.map((item) => item.phrase)).not.toContain('web portal');
    // Then the usual wordings of government buyers.
    expect(websites.map((item) => item.phrase)).toContain('website development');
    expect(websites.find((item) => item.phrase === 'website development')?.reason).toBe('often used by government buyers');
  });

  it('suggests a phrase that stands beside a family phrase in two approved titles', () => {
    const result = suggestFamilyWords({
      families: [{ name: 'Portals', phrases: ['web portal'] }],
      keywords: ['web portal'],
      excludedKeywords: [],
      approved: [
        tender('Web Portal and Citizen Dashboard for Coimbatore Smart City'),
        tender('Citizen Dashboard and Web Portal for Madurai Smart City'),
        tender('Citizen Dashboard for Salem'),
      ],
    });
    expect(result.byFamily.Portals).toContainEqual({ phrase: 'citizen dashboard', reason: 'beside “web portal” in 2 tenders you approved' });
  });

  it('finds the starter family of a family named differently, by a shared phrase', () => {
    const result = suggestFamilyWords({
      families: [{ name: 'Apps', phrases: ['mobile application'] }],
      keywords: ['mobile application'],
      excludedKeywords: [],
      approved: [],
    });
    expect(result.byFamily.Apps.map((item) => item.phrase)).toEqual(expect.arrayContaining(['mobile app', 'android application', 'ios application']));
  });

  it('offers AMC wordings only with a note, never as anything added', () => {
    const result = suggestFamilyWords({
      families: [{ name: 'Software AMC', phrases: [] }],
      keywords: ['software development'],
      excludedKeywords: ['maintenance'],
      approved: [],
    });
    const amc = result.byFamily['Software AMC'];
    expect(amc.find((item) => item.phrase === 'software maintenance')?.note).toMatch(/excluded word “maintenance”/);
    expect(amc.find((item) => item.phrase === 'software amc')?.note).toMatch(/AMC/);
  });

  it('offers the starter families not made yet, with the operator’s own words that belong in them', () => {
    const result = suggestFamilyWords({
      families: [{ name: 'websites', phrases: [] }],
      keywords: ['mobile app', 'software development'],
      excludedKeywords: [],
      approved: [],
    });
    expect(result.starters.map((item) => item.name)).not.toContain('Websites');
    expect(result.starters.find((item) => item.name === 'Mobile apps')?.yours).toEqual(['mobile app']);
    expect(result.starters).toHaveLength(STARTER_FAMILIES.length - 1);
  });
});

describe('conflictNote', () => {
  it('names the excluded word that would still reject the phrase', () => {
    expect(conflictNote('software AMC', ['AMC'])).toMatch(/“AMC”/);
    expect(conflictNote('web portal', ['printer'])).toBeUndefined();
  });
});
