import { describe, expect, it } from 'vitest';
import { bidDocumentUrl, bidKindLabel, categoryOf, istWallClock, parseGemBid, portalStyleDate, refreshCategoryNames, sameCategory } from '../../src/gem/gemBid.js';

const DOC = {
  id: '9843119',
  b_id: [9843119],
  b_bid_number: ['GEM/2026/B/7993226'],
  b_category_name: ['Facility Management Services - LumpSum Based - Residential; Housekeeping, Security Services, O&M of'],
  bd_category_name: ['Facility Management Services - LumpSum Based - Residential; Housekeeping, Security Services, O&M of Mechanical Work'],
  b_total_quantity: [1],
  b_status: [1],
  b_bid_type: [1],
  b_cat_id: ['services_home_fa85086605_fa43870134'],
  final_start_date_sort: ['2026-09-16T12:32:02Z'],
  final_end_date_sort: ['2026-10-07T12:00:00Z'],
  ba_official_details_deptName: ['Labour and Employment Department Gujarat'],
  is_high_value: [false],
};

describe('GeM bid records', () => {
  it('reads a list record, keeping GeM’s Indian times as they are shown', () => {
    const bid = parseGemBid(DOC)!;
    expect(bid).toMatchObject({
      id: '9843119',
      bidNumber: 'GEM/2026/B/7993226',
      kind: 'BID',
      category: 'Facility Management Services',
      ministry: null,
      department: 'Labour and Employment Department Gujarat',
      startsAt: '2026-09-16T12:32:02',
      endsAt: '2026-10-07T12:00:00',
      quantity: 1,
      cancelled: false,
    });
    expect(bid.title).toContain('O&M of Mechanical Work');
  });

  it('treats NA as no value, and knows reverse auctions and cancelled bids', () => {
    const bid = parseGemBid({ ...DOC, b_bid_number: ['GEM/2026/R/746323'], b_bid_type: [2], b_status: [3], ba_official_details_deptName: ['NA'], b_bid_number_parent: ['GEM/2026/B/7801861'] })!;
    expect(bid.kind).toBe('RA');
    expect(bid.cancelled).toBe(true);
    expect(bid.department).toBeNull();
    expect(bid.parentBidNumber).toBe('GEM/2026/B/7801861');
    expect(bidDocumentUrl(bid)).toBe('https://bidplus.gem.gov.in/showradocumentPdf/9843119');
    expect(bidKindLabel(bid)).toBe('Reverse auction');
  });

  it('skips a record with no bid number', () => {
    expect(parseGemBid({ b_id: [1] })).toBeNull();
  });

  it('names the category as the part before the first " - "', () => {
    expect(categoryOf('Custom Bid for Services - Hiring of 1 Gbps circuit')).toBe('Custom Bid for Services');
    expect(categoryOf('Hiring Of Agency For It Projects- Milestone Basis - Phase 1')).toBe('Hiring Of Agency For It Projects- Milestone Basis');
    expect(sameCategory('Custom Bid For Services', 'custom bid for  services')).toBe(true);
  });

  it('writes times the way GePNIC sites show them, so closing dates work the same', () => {
    expect(istWallClock('2026-10-07T12:00:00Z')).toBe('2026-10-07T12:00:00');
    expect(portalStyleDate('2026-10-07T12:00:00')).toBe('07-Oct-2026 12:00 PM');
    expect(portalStyleDate('2026-10-07T00:05:00')).toBe('07-Oct-2026 12:05 AM');
    expect(portalStyleDate('2026-10-07T15:30:00')).toBe('07-Oct-2026 03:30 PM');
    expect(portalStyleDate(null)).toBeNull();
  });
});

describe('keeping chosen GeM categories in step with GeM’s list', () => {
  it('swaps a name whose example GeM changed for the current one, and keeps the rest', () => {
    const list = ['Custom Bid For Services', 'Software Support Services 2.0 - Sap; Application Software', 'Annual Maintenance Service - Desktop', 'Annual Maintenance Service - Cctv System'];
    expect(refreshCategoryNames([
      'Custom Bid For Services',
      'Software Support Services 2.0 - Microsoft; Operating System Software',
      'Software Support Services 2.0 - Sap; Application Software',
      'Annual Maintenance Service - Photocopier', // two entries share this category: left alone
      'Something Gone',
    ], list)).toEqual([
      'Custom Bid For Services',
      'Software Support Services 2.0 - Sap; Application Software',
      'Annual Maintenance Service - Photocopier',
      'Something Gone',
    ]);
  });
});
