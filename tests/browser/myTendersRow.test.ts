import { describe, expect, it } from 'vitest';
import { parseMyTendersRow } from '../../src/browser/myTendersController.js';

describe('a My Tenders row', () => {
  it('gives its Tender ID and, with its three dates, the published day', () => {
    expect(parseMyTendersRow('1. 26-Oct-2026 10:15 AM 05-Nov-2026 03:00 PM 06-Nov-2026 11:00 AM [Survey work] [REF/1][2026_TNPL_708123_1] TNPL'))
      .toEqual({ tenderPortalId: '2026_TNPL_708123_1', publishedDay: '2026-10-26' });
  });

  it('does not guess the published day from a row with fewer dates', () => {
    expect(parseMyTendersRow('1 2026_TNPL_708123_1 Survey work 05-Nov-2026 03:00 PM')).toEqual({ tenderPortalId: '2026_TNPL_708123_1', publishedDay: null });
  });

  it('is nothing without a Tender ID', () => {
    expect(parseMyTendersRow('S.No Tender ID Title')).toBeNull();
  });
});
