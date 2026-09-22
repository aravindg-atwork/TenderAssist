import { describe, expect, it } from 'vitest';
import { evaluateExcludedScope, evaluateIntentKeywords } from '../../src/classification/intentGates.js';

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

  it('rejects excluded primary-scope terms', () => {
    const result = evaluateExcludedScope('Annual Maintenance Contract for desktop computer', [
      'AMC',
      'desktop computer',
    ]);
    expect(result.result).toBe('REJECT');
    expect(result.matchedTerms).toEqual(['desktop computer']);
  });
});
