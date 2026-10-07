import { describe, expect, it } from 'vitest';
import { evaluateExcludedScope, evaluateIntentKeywords, evaluateTenderIntent } from '../../src/classification/intentGates.js';

describe('intent gates', () => {
  it('matches full normalized intent phrases, case-insensitively', () => {
    const result = evaluateIntentKeywords(
      'Design and development of a WEB-APPLICATION for public services',
      ['web application', 'video production']
    );
    expect(result.result).toBe('PASS');
    expect(result.matchedTerms).toEqual(['web application']);
  });

  it('rejects detail text with no configured intent phrase', () => {
    expect(evaluateIntentKeywords('Supply of office chairs', ['software development']).result).toBe('REJECT');
  });

  it('matches a multi-word intent when portal wording changes the word order', () => {
    const result = evaluateIntentKeywords(
      'The scope covers development, implementation, and support of custom software.',
      ['software development']
    );
    expect(result.result).toBe('PASS');
    expect(result.matchedTerms).toEqual(['software development']);
  });

  it('rejects excluded primary-scope terms', () => {
    const result = evaluateExcludedScope('Annual Maintenance Contract for desktop computer', [
      'AMC',
      'desktop computer',
    ]);
    expect(result.result).toBe('REJECT');
    expect(result.matchedTerms).toEqual(['desktop computer']);
  });
});

describe('evaluateTenderIntent', () => {
  it('counts single words only in the title, and phrases anywhere with their words together', () => {
    const words = ['website', 'mobile app', 'software AMC'];
    expect(evaluateTenderIntent('Website redesign', '', words).intent.matchedTerms).toEqual(['website']);
    // The page around a tender mentions "website" and "app" everywhere.
    expect(evaluateTenderIntent('Lease of public toilet', 'Visit the portal website. Download the mobile version of the app.', words).intent.result).toBe('REJECT');
    expect(evaluateTenderIntent('Field staff tracking', 'Scope: develop a mobile app for field staff.', words).intent.matchedTerms).toEqual(['mobile app']);
    expect(evaluateTenderIntent('AMC for furnaces and software', 'AMC of furnace software', words).intent.result).toBe('REJECT');
    expect(evaluateTenderIntent('', '', words).intent.result).toBe('UNCERTAIN');
  });
});
