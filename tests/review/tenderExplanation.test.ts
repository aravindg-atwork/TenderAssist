import { describe, expect, it } from 'vitest';
import { explainScreening, type ScreenedGate } from '../../src/review/tenderExplanation.js';

const gate = (id: ScreenedGate['gate'], result: ScreenedGate['result'], reasonCode: string, evidence: Record<string, unknown> = {}): ScreenedGate =>
  ({ gate: id, result, reasonCode, evidence });

describe('explainScreening with word families', () => {
  const gates = [
    gate('G2', 'PASS', 'PRODUCT_CATEGORY_MATCH', { matched: ['Computer- S/W'] }),
    gate('G3', 'PASS', 'INTENT_KEYWORD_MATCH', { matchedKeywords: ['web portal', 'software development'] }),
  ];

  it('names the family of each matched word that has one', () => {
    const explanation = explainScreening('KEEP', gates, [{ name: 'Websites', phrases: ['Web Portal', 'website development'] }]);
    expect(explanation.sentence).toBe('Recommended: category “Computer- S/W”; matched “web portal” (Websites), “software development”.');
  });

  it('reads as before with no families', () => {
    expect(explainScreening('KEEP', gates).sentence).toBe('Recommended: category “Computer- S/W”; matched “web portal”, “software development”.');
  });
});
