import { describe, expect, it } from 'vitest';
import { corrigendaSummary, isWatched, tenderPageFacts } from '../../src/review/watchedTenders.js';

// Flattened page text, as saved from Tamil Nadu tender pages (9 Oct 2026).
const PAGE = 'Critical Dates Publish Date 17-Sep-2026 06:00 PM Bid Opening Date 07-Oct-2026 04:00 PM '
  + 'Bid Submission Start Date 17-Sep-2026 06:10 PM Bid Submission End Date 06-Oct-2026 03:00 PM Tender Documents NIT Document '
  + 'S.No Document Name Description Document Size (in KB) 1 Tendernotice_1.pdf GST AND STATUTORY 4957.60 '
  + 'Work Item Documents S.No Document Type Document Name Description Document Size (in KB) 1 BOQ BOQ_847931.xls PRICE BID 343.00 '
  + 'Latest Corrigendum List S.No Corrigendum Title Corrigendum Type View 1 DUE DATE EXTENSION 2 Date 2 PreBid Response1 Other '
  + 'Tender Inviting Authority Name A G M (TOS) Address TAMIL NADU NEWSPRINT AND PAPERS LIMITED';

describe('tenderPageFacts', () => {
  it('reads the closing date and every corrigendum row, a title that ends in a number included', () => {
    expect(tenderPageFacts(PAGE)).toEqual({
      closingDateRaw: '06-Oct-2026 03:00 PM',
      corrigenda: [
        { portalNumber: '1', title: 'DUE DATE EXTENSION 2', description: 'Date', publishedAt: null },
        { portalNumber: '2', title: 'PreBid Response1', description: 'Other', publishedAt: null },
      ],
    });
  });

  it('keeps a title with its own dates and numbers whole', () => {
    const page = 'Latest Corrigendum List S.No Corrigendum Title Corrigendum Type View 1 Time extension for SE/O/CBE/F.SDPM Vehicle/ ET.14/2026, Dt.16.09.2026 Date Tender Inviting Authority';
    expect(tenderPageFacts(page).corrigenda.map((entry) => entry.title)).toEqual(['Time extension for SE/O/CBE/F.SDPM Vehicle/ ET.14/2026, Dt.16.09.2026']);
  });

  it('finds nothing on a page without them', () => {
    expect(tenderPageFacts('Tender Documents NIT Document')).toEqual({ closingDateRaw: null, corrigenda: [] });
    expect(tenderPageFacts(null)).toEqual({ closingDateRaw: null, corrigenda: [] });
  });

  it('summarises corrigenda for the report sheet', () => {
    expect(corrigendaSummary(tenderPageFacts(PAGE).corrigenda)).toBe('1. DUE DATE EXTENSION 2 (Date); 2. PreBid Response1 (Other)');
  });
});

describe('isWatched', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const open = { closing_at: '2026-10-14T09:30:00Z', first_seen_at: '2026-10-01T00:00:00Z' };

  it('watches approved, decide-later and waiting tenders while open', () => {
    expect(isWatched({ ...open, lifecycle: 'APPROVED', recommendation: 'KEEP' }, now)).toBe(true);
    expect(isWatched({ ...open, lifecycle: 'DEFERRED', recommendation: 'UNCERTAIN' }, now)).toBe(true);
    expect(isWatched({ ...open, lifecycle: 'SCREENED', recommendation: 'UNCERTAIN' }, now)).toBe(true);
  });

  it('does not watch rejected tenders, by the rules or by hand', () => {
    expect(isWatched({ ...open, lifecycle: 'SCREENED', recommendation: 'REJECT' }, now)).toBe(false);
    expect(isWatched({ ...open, lifecycle: 'REJECTED', recommendation: 'KEEP' }, now)).toBe(false);
  });

  it('keeps checking three days after closing, then stops', () => {
    const approved = { lifecycle: 'APPROVED' as const, recommendation: 'KEEP', first_seen_at: '2026-09-20T00:00:00Z' };
    expect(isWatched({ ...approved, closing_at: '2026-10-07T09:30:00Z' }, now)).toBe(true);
    expect(isWatched({ ...approved, closing_at: '2026-10-05T09:30:00Z' }, now)).toBe(false);
  });

  it('checks a tender with no known closing date for 30 days after it was found', () => {
    expect(isWatched({ lifecycle: 'APPROVED', recommendation: 'KEEP', closing_at: null, first_seen_at: '2026-09-20T00:00:00Z' }, now)).toBe(true);
    expect(isWatched({ lifecycle: 'APPROVED', recommendation: 'KEEP', closing_at: null, first_seen_at: '2026-08-20T00:00:00Z' }, now)).toBe(false);
  });
});
