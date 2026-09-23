import { describe, expect, it } from 'vitest';
import { extractTenderRequirements } from '../../src/extraction/requirementExtractor.js';

describe('extractTenderRequirements', () => {
  it('extracts traceable tender requirement fields', () => {
    const result = extractTenderRequirements(`
      Scope of Work: Design and develop a citizen services web application.
      Eligibility: The bidder must have completed three similar projects.
      EMD: INR 50,000. Tender Fee: INR 1,000.
      Bid Submission End Date: 30-Sep-2026 15:00.
      Online submission must be completed through the eProcurement portal.
      Contact Person: Project Director, director@example.test
    `);
    expect(result.requirements.scope).toContain('Scope of Work');
    expect(result.requirements.emd).toContain('INR 50,000');
    expect(result.requirements.tenderFee).toContain('INR 1,000');
    expect(result.confidence).toBe('HIGH');
  });

  it('marks sparse text as low confidence instead of inventing fields', () => {
    const result = extractTenderRequirements('General procurement notice.');
    expect(result.confidence).toBe('LOW');
    expect(Object.values(result.requirements).every((value) => value === null)).toBe(true);
  });
});
