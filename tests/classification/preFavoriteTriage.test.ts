import { describe, expect, it } from 'vitest';
import { triageTenderDetail, triageTenderTitle } from '../../src/classification/preFavoriteTriage.js';

const intent = {
  keywords: ['software development', 'web application', 'video production'],
  excludedKeywords: ['annual maintenance contract', 'desktop computer'],
};

describe('pre-favorite tender triage', () => {
  it('favorites an explicit title match with high confidence', () => {
    const result = triageTenderTitle('Design and development of a citizen web application', intent);
    expect(result.action).toBe('FAVORITE');
    expect(result.confidence).toBe('HIGH');
    expect(result.intent.matchedTerms).toEqual(['web application']);
  });

  it('rejects an excluded title before consuming a portal favorite slot', () => {
    const result = triageTenderTitle('Annual maintenance contract for desktop computers', intent);
    expect(result.action).toBe('REJECT');
    expect(result.reasonCode).toBe('TITLE_EXCLUDED_SCOPE');
  });

  it('sends a broad title to detail review instead of guessing', () => {
    const result = triageTenderTitle('Selection of implementation agency', intent);
    expect(result.action).toBe('REVIEW_DETAIL');
    expect(result.confidence).toBe('LOW');
  });

  it('favorites a broad title only after its detail proves intent', () => {
    const result = triageTenderDetail(
      'Selection of implementation agency',
      'The agency will design and deliver a citizen-facing web application.',
      'Selection of implementation agency Information Technology',
      intent
    );
    expect(result.action).toBe('FAVORITE');
    expect(result.confidence).toBe('MEDIUM');
  });

  it('rejects a broad title when its detail has no intent match', () => {
    const result = triageTenderDetail(
      'Selection of implementation agency',
      'Supply and installation of office furniture.',
      'Selection of implementation agency Furniture',
      intent
    );
    expect(result.action).toBe('REJECT');
    expect(result.reasonCode).toBe('DETAIL_NO_INTENT_MATCH');
  });
});
