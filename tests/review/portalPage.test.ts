import { describe, expect, it } from 'vitest';
import { coverDocuments, tenderPageFields } from '../../src/review/portalPage.js';

// The field block as saved from a Tamil Nadu tender page (16 Oct 2026), its
// tables read as label | value cells; the login e-mail replaced.
const PAGE = [
  'Welcome: :',
  'someone@example.in: Server Time',
  'Last login: :',
  'Tender ID: 2026_HRCE_713793_1',
  'S.No: Bank Name',
  '1: SBI Bank',
  'Cover No: Cover',
  'Document Type: Description',
  '1: Fee/PreQual/Technical',
  '.pdf: Self-attested PAN copy, latest Income Tax Return filed',
  '.pdf: Self-attested GST registration copy',
  '2: Finance',
  '.xls: BOQ',
  'Tender Fee in ₹: 0.00',
  'EMD Amount in ₹: 10,00,000',
  'Tender Value in ₹: 35,00,000',
  'Location: Courtallam',
  'S.No: Document Name',
  'Description: Document Size (in KB)',
  '1: Tendernotice_1.pdf',
  'Tender Inviting Authority: 262.93',
  'Name: Assistant Commissioner/ Executive officer',
  '',
  'Page text…',
].join('\n');

describe('a saved Tamil Nadu tender page', () => {
  it('keeps the tender’s own fields and leaves out table rows, sizes and the login lines', () => {
    expect(tenderPageFields(PAGE)).toEqual([
      { label: 'Tender ID', value: '2026_HRCE_713793_1' },
      { label: 'Tender Fee in ₹', value: '0.00' },
      { label: 'EMD Amount in ₹', value: '10,00,000' },
      { label: 'Tender Value in ₹', value: '35,00,000' },
      { label: 'Location', value: 'Courtallam' },
      { label: 'Name', value: 'Assistant Commissioner/ Executive officer' },
    ]);
  });

  it('reads the documents to upload, cover by cover', () => {
    expect(coverDocuments(PAGE)).toEqual([
      { cover: 'Fee/PreQual/Technical', documents: [
        { type: 'PDF', description: 'Self-attested PAN copy, latest Income Tax Return filed' },
        { type: 'PDF', description: 'Self-attested GST registration copy' },
      ] },
      { cover: 'Finance', documents: [{ type: 'XLS', description: 'BOQ' }] },
    ]);
    expect(coverDocuments('Bid Number: GEM/2026/B/1\n\nbody')).toEqual([]);
  });
});
