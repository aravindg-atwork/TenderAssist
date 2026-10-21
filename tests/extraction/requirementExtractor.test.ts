import { describe, expect, it } from 'vitest';
import { extractTenderRequirements, REQUIREMENTS_VERSION } from '../../src/extraction/requirementExtractor.js';

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
    const { version, ...fields } = result.requirements;
    expect(version).toBe(REQUIREMENTS_VERSION);
    expect(Object.values(fields).every((value) => value === null)).toBe(true);
  });

  it('never takes a heading or a blank form for a value', () => {
    const { requirements } = extractTenderRequirements([
      'Bid Number: GEM/2026/B/8118466',
      'Work Description: Custom Bid for Services - Website Development',
      '',
      'EMD Detail ePBG Detail',
      'Bid Participation fee / Tender fee, as the case may be',
      'Name: ____________________',
      'Contact the buyer at hod1.icpr.up@gembuyer.in for queries.',
    ].join('\n'));
    expect(requirements.emd).toBeNull();
    expect(requirements.tenderFee).toBeNull();
    expect(requirements.contact).toBe('hod1.icpr.up@gembuyer.in');
    expect(requirements.submissionMethod).toBe('Online on GeM');
    expect(requirements.scope).toBe('Custom Bid for Services - Website Development');
  });

  it('adds the criteria in the documents to a website field that only points at them', () => {
    const documents = [{
      file_name: 'NIT.pdf',
      text_content: [
        '[Page 3]',
        '4. Eligibility Criteria',
        '1. The bidder should have an average annual turnover of Rs. 50 lakh in the last three financial years.',
        '2. The bidder should have completed two similar works of value not less than Rs. 20 lakh each in the last five years.',
        '3. The bidder should not be blacklisted by any Government department.',
        '5. Scope of Work',
      ].join('\n'),
    }];
    const { requirements } = extractTenderRequirements('Pre Qualification: Please refer Tender documents.\nEMD Amount in ₹: 25,000\n\nPage text', documents);
    expect(requirements.eligibility).toBe([
      '1. The bidder should have an average annual turnover of Rs. 50 lakh in the last three financial years.',
      '2. The bidder should have completed two similar works of value not less than Rs. 20 lakh each in the last five years.',
      '3. The bidder should not be blacklisted by any Government department.',
    ].join('\n'));
    expect(requirements.sections).toHaveLength(1);
    expect(requirements.sections![0]).toMatchObject({ kind: 'PRE_QUALIFICATION', heading: '4. Eligibility Criteria', document: 'NIT.pdf', page: 3 });
    expect(requirements.sections![0].items).toHaveLength(3);
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
      version: REQUIREMENTS_VERSION,
    });
    expect(confidence).toBe('HIGH');
  });
});
