import { describe, expect, it } from 'vitest';
import { unsureReason } from '../../src/orchestration/classificationPhaseRunner.js';

const titleHas = { result: 'PASS' as const, reasonCode: 'INTENT_KEYWORD_MATCH', matchedTerms: ['web application'] };
const titleLacks = { result: 'REJECT' as const, reasonCode: 'NO_INTENT_KEYWORD_MATCH', matchedTerms: [] };

describe('unsureReason', () => {
  it('is unsure when no check could decide the tender', () => {
    expect(unsureReason('UNCERTAIN', titleLacks, [])).toMatch(/could not decide/);
  });

  it('is unsure when a keep rests only on words in the details', () => {
    expect(unsureReason('KEEP', titleLacks, ['web application'])).toBe(
      'Its title has none of your intent words; “web application” appears only in its details.'
    );
  });

  it('is sure about a keep whose title has an intent word, and about rejects', () => {
    expect(unsureReason('KEEP', titleHas, ['web application'])).toBeNull();
    expect(unsureReason('REJECT', titleLacks, [])).toBeNull();
  });
});
