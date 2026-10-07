// Finds the GeM bids that started on one day. GeM has no "published date"
// search, but its list sorts by start date (newest first) and any page can be
// asked for, so we jump to the day by halving the page range, then read on
// until the day is over.

import type { GemBid } from './gemBid.js';
import type { GemListPage } from './gemClient.js';

const PAGE_SIZE = 10;
/** A day has a few hundred service bids; stop well before reading GeM end to end. */
export const MAX_DAY_PAGES = 400;

export interface DaySearchProgress {
  pagesRead: number;
  found: number;
}

const dayOf = (bid: GemBid): string | null => bid.startsAt?.slice(0, 10) ?? null;

/** The earliest start day on a page, ignoring bids without one. */
function oldestDay(page: GemListPage): string | null {
  const days = page.bids.map(dayOf).filter((day): day is string => day !== null);
  return days.length === 0 ? null : days.reduce((a, b) => (a < b ? a : b));
}

export async function findBidsStartedOn(
  day: string,
  listPage: (page: number) => Promise<GemListPage>,
  onProgress?: (progress: DaySearchProgress) => void,
): Promise<GemBid[]> {
  let pagesRead = 0;
  const read = async (page: number) => {
    const result = await listPage(page);
    pagesRead += 1;
    return result;
  };

  const firstPage = await read(1);
  const lastPage = Math.max(1, Math.ceil(firstPage.total / PAGE_SIZE));

  // The first page whose oldest bid started on or before the day.
  let low = 1;
  let high = lastPage;
  const cache = new Map<number, GemListPage>([[1, firstPage]]);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const page = cache.get(middle) ?? await read(middle);
    cache.set(middle, page);
    const oldest = oldestDay(page);
    if (oldest !== null && oldest <= day) high = middle;
    else low = middle + 1;
  }

  // One page earlier as well: bids that close while we read move the rest up a little.
  const found = new Map<string, GemBid>();
  for (let page = Math.max(1, low - 1), count = 0; page <= lastPage && count < MAX_DAY_PAGES; page += 1, count += 1) {
    const result = cache.get(page) ?? await read(page);
    cache.delete(page);
    for (const bid of result.bids) if (dayOf(bid) === day) found.set(bid.id, bid);
    onProgress?.({ pagesRead, found: found.size });
    const oldest = oldestDay(result);
    // Sorted newest first: once a page reaches an earlier day, the rest are all earlier.
    if (result.bids.length === 0 || (oldest !== null && oldest < day)) break;
  }
  return [...found.values()];
}
