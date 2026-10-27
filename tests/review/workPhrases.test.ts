import { describe, expect, it } from 'vitest';
import { headWordOf, matchKey, workPhrasesIn } from '../../src/review/workPhrases.js';

const phrases = (text: string) => workPhrasesIn(text).map((item) => item.phrase);

describe('workPhrasesIn', () => {
  it('finds the phrase that names the work, leaving out boilerplate and the buyer', () => {
    const found = phrases('Design, Development and Maintenance of Web Portal for TNSDC');
    expect(found[0]).toBe('web portal');
    expect(found).not.toContain('design development');
    expect(found.some((phrase) => phrase.includes('tnsdc'))).toBe(false);
  });

  it('prefers the shorter phrase that ends on a work word', () => {
    const found = phrases('Development of Android Mobile Application for Greater Chennai Corporation');
    expect(found.slice(0, 3)).toEqual(['mobile application', 'android mobile application', 'android mobile']);
    expect(found.some((phrase) => phrase.includes('chennai') || phrase.includes('corporation'))).toBe(false);
  });

  it('keeps hyphenated words together', () => {
    expect(phrases('Supply and Implementation of e-Learning Content for Anna University')).toContain('e-learning content');
    expect(phrases('Development of e-Governance Portal for Revenue Department')[0]).toBe('e-governance portal');
  });

  it('never proposes phrases of broad words only', () => {
    expect(phrases('Annual Maintenance Contract for UPS')).toEqual([]);
    expect(phrases('Design Development Implementation and Maintenance')).toEqual([]);
  });

  it('scores a phrase with no IT word as 0, below the IT ones', () => {
    const found = workPhrasesIn('Hiring of Vehicle for District Collectorate');
    expect(found.every((item) => item.score <= 0)).toBe(true);
  });
});

describe('matchKey and headWordOf', () => {
  it('compares words the way the intent gates do', () => {
    expect(matchKey('E-Learning')).toBe('e learning');
    expect(headWordOf('Web Portal')).toBe('portal');
    expect(headWordOf('mobile app')).toBe('app');
  });
});
