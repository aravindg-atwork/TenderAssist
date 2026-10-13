import { describe, expect, it } from 'vitest';
import { findBidsClosingOn, findBidsStartedOn } from '../../src/gem/gemDaySearch.js';
import type { GemBid } from '../../src/gem/gemBid.js';
import type { GemListPage } from '../../src/gem/gemClient.js';

function bid(n: number, startsAt: string): GemBid {
  return {
    id: String(n), bidNumber: `GEM/2026/B/${n}`, kind: 'BID', title: `Bid ${n}`, itemName: 'Item', category: 'Item', categoryCode: null,
    ministry: null, department: null, startsAt, endsAt: null, quantity: 1, parentBidNumber: null,
    cancelled: false, highValue: false, rateContract: false, globalTender: false,
  };
}

/** A fake GeM list: `perDay` bids for each day, newest first, ten to a page. */
function fakeList(perDay: Record<string, number>) {
  const all: GemBid[] = [];
  let n = 0;
  for (const day of Object.keys(perDay).sort().reverse()) {
    for (let i = 0; i < perDay[day]; i += 1) {
      const minute = String(59 - (i % 60)).padStart(2, '0');
      all.push(bid(n += 1, `${day}T${String(23 - Math.floor(i / 60)).padStart(2, '0')}:${minute}:00`));
    }
  }
  const pagesRead: number[] = [];
  const listPage = async (page: number): Promise<GemListPage> => {
    pagesRead.push(page);
    return { total: all.length, bids: all.slice((page - 1) * 10, page * 10) };
  };
  return { all, listPage, pagesRead };
}

describe('finding the GeM bids that started on one day', () => {
  it('finds exactly that day’s bids without reading the whole list', async () => {
    const { all, listPage, pagesRead } = fakeList({ '2026-10-08': 95, '2026-10-07': 314, '2026-10-06': 287, '2026-10-05': 402, '2026-10-01': 900 });
    const found = await findBidsStartedOn('2026-10-06', listPage);
    expect(found).toHaveLength(287);
    expect(found.every((item) => item.startsAt!.startsWith('2026-10-06'))).toBe(true);
    expect(new Set(found.map((item) => item.id)).size).toBe(287);
    // The day spans about 30 pages; finding it takes about a dozen more, not the 200 in the list.
    expect(pagesRead.length).toBeLessThan(50);
    expect(all.length).toBe(1998);
  });

  it('finds the newest day, and nothing for a day with no bids', async () => {
    const { listPage } = fakeList({ '2026-10-08': 12, '2026-10-07': 30 });
    expect(await findBidsStartedOn('2026-10-08', listPage)).toHaveLength(12);
    expect(await findBidsStartedOn('2026-10-09', listPage)).toHaveLength(0);
    expect(await findBidsStartedOn('2026-10-01', listPage)).toHaveLength(0);
  });

  it('copes with an empty list', async () => {
    const found = await findBidsStartedOn('2026-10-06', async () => ({ total: 0, bids: [] }));
    expect(found).toEqual([]);
  });
});

describe('finding the GeM bids that close on one day', () => {
  const closingList = (count: number) => Array.from({ length: count }, (_, i) => bid(i + 1, `2026-10-0${1 + (i % 8)}T10:${String(i % 60).padStart(2, '0')}:00`));

  it('reads every page of GeM’s end-date list once when nothing moves', async () => {
    const all = closingList(57);
    const pagesRead: number[] = [];
    const result = await findBidsClosingOn(async (page) => {
      pagesRead.push(page);
      return { total: all.length, bids: all.slice((page - 1) * 10, page * 10) };
    });
    expect(result.complete).toBe(true);
    expect(result.total).toBe(57);
    expect(result.bids).toHaveLength(57);
    expect(pagesRead).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reads again when a bid drops out mid-read, so the bids moved up a page are not missed', async () => {
    let all = closingList(30);
    let reads = 0;
    const result = await findBidsClosingOn(async (page) => {
      reads += 1;
      // After page 1 a bid on it closes: every later bid moves up one place.
      if (reads === 2) all = all.slice(1);
      return { total: all.length, bids: all.slice((page - 1) * 10, page * 10) };
    });
    // The first read misses the bid that moved from page 2 to page 1; the second finds it.
    expect(result.bids.map((item) => item.id)).toContain('11');
    expect(result.complete).toBe(true);
    expect(reads).toBe(6);
  });

  it('says when GeM counts more bids than it lets us read', async () => {
    const all = closingList(25);
    const result = await findBidsClosingOn(async (page) => ({ total: 30, bids: all.slice((page - 1) * 10, page * 10) }));
    expect(result.complete).toBe(false);
    expect(result.bids).toHaveLength(25);
    expect(result.total).toBe(30);
  });

  it('copes with a day where nothing closes', async () => {
    expect(await findBidsClosingOn(async () => ({ total: 0, bids: [] }))).toEqual({ bids: [], total: 0, complete: true });
  });
});
