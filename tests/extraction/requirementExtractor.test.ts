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

  it('fills the sheet from the portal fields on the tender details page', () => {
    const text = [
      'Organisation Chain: Tamil Nadu Newsprint and Papers Limited||TNPL Unit II',
      'Tender Reference Number: TNPL/U2/2026/101',
      'Tender Type: Open Tender',
      'Form Of Contract: Item Rate',
      'Tender Fee in ₹: 1,180',
      'EMD Amount in ₹: 25,000',
      'Title: Documentary film on mill operations',
      'Work Description: Production of a 10 minute documentary film covering mill operations',
      'Pre Qualification: Please refer Tender documents.',
      'Bid Submission End Date: 25-Sep-2026 03:00 PM',
      'Name: Deputy General Manager (Purchase)',
      'Address: TNPL Unit II, Mondipatti, Trichy',
      '',
      'Tenders Tamil Nadu ... full page text ...',
    ].join('\n');
    const { requirements, confidence } = extractTenderRequirements(text);
    expect(requirements).toEqual({
      scope: 'Production of a 10 minute documentary film covering mill operations',
      eligibility: 'Please refer Tender documents.',
      emd: '25,000',
      tenderFee: '1,180',
      submissionDeadline: '25-Sep-2026 03:00 PM',
      submissionMethod: 'Online on the portal, tender type Open Tender, contract Item Rate',
      contact: 'Deputy General Manager (Purchase), TNPL Unit II, Mondipatti, Trichy',
    });
    expect(confidence).toBe('HIGH');
  });
});
