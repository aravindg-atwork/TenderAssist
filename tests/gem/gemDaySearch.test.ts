import { describe, expect, it } from 'vitest';
import { findBidsStartedOn } from '../../src/gem/gemDaySearch.js';
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
