import { describe, expect, it } from 'vitest';
import { BID_TEXT } from './bidTextFixture.js';
import { attachmentsFromBid, bidSpecificText, factsFromBidText, readableBidText, rupees } from '../../src/gem/gemBidDocument.js';

const LINKS = [
  'https://bidplus.gem.gov.in/resources/upload_nas/SepQ326/bidding/excel/bid-9843119/1789541602.xlsx',
  'https://bidplus.gem.gov.in/resources/upload_nas/SepQ326/bidding/biddoc/bid-9843119/1789541615.pdf',
  'https://bidplus.gem.gov.in/resources/upload_nas/SepQ326/bidding/biddoc/bid-9843119/1789541628.pdf',
  'https://bidplus.gem.gov.in/resources/upload_nas/SepQ326/bidding/biddoc/bid-9843119/1789541628.pdf',
  'https://bidplus.gem.gov.in/resources/upload_nas/OctQ426/bidding/biddoc/bid-9843119/1791307657.pdf',
  'https://fulfilment.gem.gov.in/contract/slafds?fileDownloadPath=SLA_UPLOAD_PATH/2026/Sep/GEM_2026_B_7993226/MasterPlan.pdf',
  'https://admin.gem.gov.in/apis/v1/gtc/pdfByDate/?date=20260916',
  'https://bidplus.gem.gov.in/bidding/bid/bidsla/96886991648161',
];

describe('reading a GeM bid PDF', () => {
  it('reads the facts the eligibility sheet needs from the English labels', () => {
    expect(factsFromBidText(BID_TEXT)).toEqual({
      bidEndsAt: '07-10-2026 12:00:00',
      bidOpensAt: '08-10-2026 12:00:00',
      offerValidity: '180 (Days)',
      ministry: 'Gujarat',
      department: 'Labour And Employment Department Gujarat',
      organisation: 'Gujarat Building & Other Construction Workers Welfare Board (gbocwwb)',
      office: 'Ahmedabad',
      itemCategory: 'Facility Management Services - LumpSum Based - Residential; Housekeeping, Security Services',
      contractPeriod: '2 Year(s)',
      minimumTurnover: '212.51 Lakh (s)',
      pastExperience: '3 Year (s)',
      mseRelaxation: 'Yes | Partial | Turn over value - 12 (in lakhs)',
      startupRelaxation: 'No',
      documentsRequired: 'Experience Criteria,Bidder Turnover,Certificate (Requested in ATC)',
      bidToRa: 'Yes',
      bidType: 'Two Packet Bid',
      estimatedValue: '10625689.63',
      emdAmount: '318771',
      epbgPercentage: '5.00',
      evaluationMethod: 'Total value wise evaluation',
      totalQuantity: null,
    });
  });

  it('names the buyer’s attachments as the bid names them, and skips general GeM pages', () => {
    expect(attachmentsFromBid({ text: BID_TEXT, links: LINKS })).toEqual([
      { url: LINKS[0], fileName: 'Financial price break.xlsx' },
      { url: LINKS[1], fileName: 'Details of the premise.pdf' },
      { url: LINKS[2], fileName: 'Scope of work.pdf' },
      { url: LINKS[4], fileName: 'Undertaking of Competent Authority is mandatory to create Custom Bid for Services.pdf' },
      { url: LINKS[5], fileName: 'Service level agreement.pdf' },
    ]);
  });

  it('checks intent words only against the part about this bid, not GeM’s general terms', () => {
    const specific = bidSpecificText(BID_TEXT);
    expect(specific).toContain('Type of services required Housekeeping');
    expect(specific).not.toContain('Software development');
    expect(specific).not.toMatch(/[^\x20-\x7E₹]/);
  });

  it('keeps the English text readable line by line', () => {
    const readable = readableBidText(BID_TEXT);
    expect(readable.split('\n').some((line) => line.endsWith('/Ministry/State Name Gujarat'))).toBe(true);
    expect(readable).not.toMatch(/[^\x20-\x7E₹\n]/);
  });

  it('writes rupees the Indian way', () => {
    expect(rupees('10625689.63')).toBe('1,06,25,689.63');
    expect(rupees('318771')).toBe('3,18,771');
    expect(rupees(null)).toBeNull();
  });
});
