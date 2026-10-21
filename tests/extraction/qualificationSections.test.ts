import { describe, expect, it } from 'vitest';
import { criteriaSummary, findQualificationSections, gemEvaluationNote, unwrap } from '../../src/extraction/qualificationSections.js';

// Shaped like the WDRA mobile app RFP on GeM (GEM/2026/B/8085066): contents, a
// cross-reference, then the criteria table running over a page break.
const RFP = [
  '5.5 Pre-Qualification Evaluation Criteria ...................................................... 32',
  '5.6 Technical Evaluation Criteria .............................................................. 35',
  '[Page 22]',
  '4.1 Eligible Bidders',
  'All the pre-qualification criteria shall be met by the Bidder. The Pre-Qualification',
  'criteria (Section 5.5) may be referred to for details.',
  '[Page 32]',
  '32 | P a g e',
  '5.5 Pre-Qualification Evaluation Criteria',
  'The Bidder’s Pre-Qualification Proposal will be evaluated as per the following criteria. Each criterion is',
  'mandatory — failure to meet any one criterion shall result in disqualification of the entire proposal.',
  '# Parameter Pre-Qualification Criteria',
  '1 Legal Entity',
  'The Bidder should be a company incorporated in India under the',
  'Companies Act, 1956/2013.',
  '2 Sales Turnover',
  'The Bidder shall have an average annual',
  'revenue/sales turnover of at least INR',
  '40 Crore in the last three financial years.',
  '[Page 33]',
  '33 | P a g e',
  '# Parameter Pre-Qualification Criteria',
  '3 Net Worth',
  'The Bidder shall show positive net',
  'worth for the three consecutive financial years.',
  '4 Security & Compliance',
  'The Bidder shall comply with Government of India IT policies.',
  '[Page 35]',
  '5.6 Technical Evaluation Criteria',
  'The Bidder’s technical solution proposed in the Technical Proposal document will be evaluated as per the',
  'criteria mentioned below.',
  'A. Resource Strength (25 marks)',
  '1 Resource Deployment Plan & Governance Structure 5',
  '2 Proposed Key Personnel 20',
  'B. Bidder Experience (35 marks)',
  '1 Sales Turnover: ≥ 100 Cr: 5 marks',
  '6. Commercial Evaluation',
  'The lowest quoted price is ranked L1.',
].join('\n');

describe('qualification sections in tender documents', () => {
  it('reads the criteria table over its page break, row by row, skipping contents and cross-references', () => {
    const sections = findQualificationSections([{ name: 'RFP.pdf', text: RFP }]);
    const criteria = sections.find((section) => section.heading === '5.5 Pre-Qualification Evaluation Criteria')!;
    expect(criteria).toMatchObject({ kind: 'PRE_QUALIFICATION', document: 'RFP.pdf', page: 32 });
    expect(criteria.items.map((item) => item.split(' ').slice(0, 3).join(' '))).toEqual(['1 Legal Entity', '2 Sales Turnover', '3 Net Worth', '4 Security &']);
    // Wrapped lines are joined; the row that read "40 Crore…" is not a heading.
    expect(criteria.items[1]).toContain('turnover of at least INR 40 Crore in the last three financial years.');
    expect(criteria.text).not.toContain('P a g e');
    expect(criteria.text.match(/# Parameter/g)).toHaveLength(1);
    // The next row number (4) is a row, not a chapter, even after a page break; 5.6 ends 5.5.
    expect(criteria.items[3]).toMatch(/^4 Security & Compliance/);
    expect(criteria.text).not.toContain('Technical Proposal document');
    // The contents line ("…… 32") and the one-line cross-reference are not sections.
    expect(sections.filter((section) => section.heading.startsWith('5.5'))).toHaveLength(1);
  });

  it('splits technical evaluation into its lettered groups and stops at the next chapter', () => {
    const technical = findQualificationSections([{ name: 'RFP.pdf', text: RFP }]).find((section) => section.kind === 'TECHNICAL_EVALUATION')!;
    expect(technical.heading).toBe('5.6 Technical Evaluation Criteria');
    expect(technical.items).toEqual([
      '1 Resource Deployment Plan & Governance Structure 5',
      '2 Proposed Key Personnel 20',
      'B. Bidder Experience (35 marks)',
      '1 Sales Turnover: ≥ 100 Cr: 5 marks',
    ]);
    expect(technical.text).not.toContain('L1');
  });

  it('reads the buyer’s own terms from a GeM bid PDF and puts a limit on who may bid first in the summary', () => {
    const bidPdf = [
      'बड सं;या/Bid Number: GEM/2026/B/8085066',
      'बडबड ववरणववरण//Bid Details',
      '3. Buyer Added Bid Specific ATC',
      'Buyer Added text based ATC clauses',
      '1. This RFP is issued as a follow-on to the Expression of Interest (EoI). Only Bidders shortlisted pursuant to the sa',
      'id EoI shall be eligible to participate in this RFP:',
      '(a) M/s SUCCESSIVE TECHNOLOGIES PRIVATE LIMITED',
      '2. The Successful Bidder shall have to submit the Performance Bank Guarantee.',
      '4. Generic',
      'Bidder financial standing: The bidder should not be under liquidation.',
      'This Bid is based on Quality & Cost Based Selection (QCBS) .',
      'Buyer Defined Total Qualifying Marks for Technical Qualification: 60',
      'QCBS Weightage(Technical:Financial):30:70',
    ].join('\n');
    const sections = findQualificationSections([{ name: 'GeM bid.pdf', text: bidPdf }, { name: 'RFP.pdf', text: RFP }]);
    const terms = sections.find((section) => section.kind === 'BUYER_TERMS')!;
    expect(terms.items).toEqual([
      // GeM breaks lines inside words ("sa|id"); that cannot be told from "a|bid", so its text is kept as it is.
      '1. This RFP is issued as a follow-on to the Expression of Interest (EoI). Only Bidders shortlisted pursuant to the sa id EoI shall be eligible to participate in this RFP:\n(a) M/s SUCCESSIVE TECHNOLOGIES PRIVATE LIMITED',
      '2. The Successful Bidder shall have to submit the Performance Bank Guarantee.',
    ]);
    const summary = criteriaSummary(sections)!.split('\n');
    expect(summary[0]).toBe('Buyer’s terms: Only Bidders shortlisted pursuant to the sa id EoI shall be eligible to participate in this RFP: (a) M/s SUCCESSIVE TECHNOLOGIES PRIVATE LIMITED');
    expect(summary[1]).toMatch(/^1 Legal Entity The Bidder should be a company incorporated in India/);
    expect(gemEvaluationNote(bidPdf)).toBe('Quality and cost based selection (QCBS); technical qualifying marks 60; weightage technical:financial 30:70');
  });

  it('knows the headings real tenders use: slashes, a misspelling, a letter, sentence case, PQ labels', () => {
    const find = (text: string) => findQualificationSections([{ name: 'NIT.pdf', text }]).find((section) => section.kind === 'PRE_QUALIFICATION');
    const points = '1. The Bidder must be an Indian firm registered under applicable laws in India.\n2. The Bidder should not have been blacklisted by any Government department in the last 3 years.\n3. The Bidder should have a minimum of 2 years of experience in website design.';
    expect(find(`5. Qualification/Eligibility/Evaluation Criteria\nA bidder shall possess the following.\n${points}`)?.items).toHaveLength(3);
    expect(find(`A. Eligiblity Criteria\n${points}`)?.heading).toBe('A. Eligiblity Criteria');
    expect(find(`Qualification criteria of the bidders.\n${points}`)?.items).toHaveLength(3);
    expect(find(`2.4.4 Pre-Qualification Criteria\nThe pre-qualification criteria are given below: PQ1: Bidder shall be a registered company in India for 5 years. PQ2: Average turnover of Rs. 10 crore in the last three years. PQ3: Not blacklisted by any Government body.`)?.items)
      .toEqual(['1: Bidder shall be a registered company in India for 5 years.', '2: Average turnover of Rs. 10 crore in the last three years.', '3: Not blacklisted by any Government body.'].map((item) => `PQ${item}`));
  });

  it('with no eligibility heading at all, takes the numbered conditions that ask for turnover, experience or certificates', () => {
    const terms = '7. Delivery within 30 days.\n8. Bidder Turnover should be more than Rupees 45 Lakhs CA Certified.\n9. The bidder must have ISO 9001 certification.\n10. Payment after delivery.';
    const sections = findQualificationSections([{ name: 'Short.pdf', text: '1. Bidder Turnover above Rs 10 lakh.' }, { name: 'Service level agreement.pdf', text: terms }]);
    expect(sections[0]).toMatchObject({ kind: 'PRE_QUALIFICATION', heading: 'Conditions in Service level agreement.pdf' });
    expect(sections[0].items).toEqual(['8. Bidder Turnover should be more than Rupees 45 Lakhs CA Certified.', '9. The bidder must have ISO 9001 certification.']);
  });

  it('reads a file GeM attaches under two names once', () => {
    const sections = findQualificationSections([{ name: 'Scope of Work.pdf', text: RFP }, { name: 'Introduction.pdf', text: RFP }]);
    expect(new Set(sections.map((section) => section.document))).toEqual(new Set(['Scope of Work.pdf']));
  });

  it('joins wrapped lines into paragraphs but keeps points apart', () => {
    expect(unwrap(['The bidder shall have', 'an office in Chennai.', '1 Turnover', '(a) Audited', 'balance sheets'])).toBe(
      'The bidder shall have an office in Chennai.\n1 Turnover\n(a) Audited balance sheets',
    );
  });
});
