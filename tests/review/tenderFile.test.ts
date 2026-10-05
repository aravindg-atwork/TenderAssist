import { describe, expect, it } from 'vitest';
import { keyFactsFrom, parseDetailFields } from '../../src/review/tenderFile.js';

// The top of a real stored tender text (TN Tenders details page).
const STORED = [
  'Welcome: :',
  'sales@bowandbaan.com: Server Time',
  'Organisation Chain: Department of Sugar||TN Co-operative Sugar Federation(TNCSF)',
  'Tender Reference Number: PSM/2026/12',
  'Tender Fee in ₹: 0.00',
  'EMD Amount in ₹: 5,000',
  'Title: Chemical Lifting and Milk of Lime Preparation Work',
  'Work Description: Chemical Lifting and Milk of Lime Preparation Work',
  'Tender Value in ₹: NA',
  'Location: PSM ERAIYUR',
  'Period Of Work(Days): 30',
  'Bid Submission End Date: 13-Oct-2026 01:00 PM',
  'Name: CHIEF EXECUTIVE',
  '',
  'Welcome : sales@bowandbaan.com Last login : 05-Oct-2026 ... page text: with colons',
].join('\n');

describe('tender file', () => {
  it('reads the stored portal fields and stops at the page text', () => {
    const fields = parseDetailFields(STORED);
    expect(fields.map((field) => field.label)).toContain('EMD Amount in ₹');
    expect(fields.some((field) => /page text/.test(field.value))).toBe(false);
    expect(fields.some((field) => field.label === 'Welcome')).toBe(false);
  });

  it('lists the key facts in a fixed order under plain names, skipping empty values', () => {
    expect(keyFactsFrom(parseDetailFields(STORED))).toEqual([
      { label: 'Work', value: 'Chemical Lifting and Milk of Lime Preparation Work' },
      { label: 'EMD', value: '5,000' },
      { label: 'Bids close', value: '13-Oct-2026 01:00 PM' },
      { label: 'Location', value: 'PSM ERAIYUR' },
      { label: 'Work period (days)', value: '30' },
      { label: 'Organisation', value: 'Department of Sugar › TN Co-operative Sugar Federation(TNCSF)' },
      { label: 'Contact', value: 'CHIEF EXECUTIVE' },
    ]);
  });

  it('has nothing to show for a tender never read', () => {
    expect(parseDetailFields(null)).toEqual([]);
    expect(keyFactsFrom([])).toEqual([]);
  });
});
