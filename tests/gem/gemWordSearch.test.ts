import { describe, expect, it } from 'vitest';
import type { GemBid } from '../../src/gem/gemBid.js';
import type { GemBidType, GemListPage } from '../../src/gem/gemClient.js';
import { findBidsWithWords, hasSearchWord, MAX_WORD_PAGES, queryWordsFor } from '../../src/gem/gemWordSearch.js';

function bid(n: number, title: string, extra: Partial<GemBid> & { hidden?: string } = {}): GemBid & { hidden?: string } {
  return {
    id: String(n), bidNumber: `GEM/2026/B/${n}`, kind: 'BID', title, itemName: title, category: title, categoryCode: null,
    ministry: null, department: null, startsAt: '2026-10-10T10:00:00', endsAt: '2026-10-20T15:00:00', quantity: 1, parentBidNumber: null,
    cancelled: false, highValue: false, rateContract: false, globalTender: false, ...extra,
  };
}

/**
 * A fake of GeM's search box as it behaves: a plain word matches inside
 * words anywhere in the bid, including text the list does not show.
 */
function fakeGem(bids: Array<GemBid & { hidden?: string }>, type: GemBidType = 'service') {
  const asked: string[] = [];
  const listPage = async ({ keyword, bidType, page }: { keyword: string; bidType: GemBidType; page: number }): Promise<GemListPage> => {
    asked.push(`${bidType}:${keyword}:${page}`);
    if (bidType !== type) return { total: 0, bids: [] };
    const matching = bids.filter((item) => `${item.title} ${item.department ?? ''} ${item.hidden ?? ''}`.toLowerCase().includes(keyword));
    return { total: matching.length, bids: matching.slice((page - 1) * 10, page * 10).map(({ hidden: _hidden, ...rest }) => rest) };
  };
  return { listPage, asked };
}

describe('search words', () => {
  it('match whole words, with hyphen, space and plural forms', () => {
    expect(hasSearchWord('Hiring of SEO services', 'seo')).toBe(true);
    expect(hasSearchWord('Printer cartridge for HP SEOLA 1802', 'seo')).toBe(false);
    expect(hasSearchWord('Relief Valve Model: VSEOT', 'seo')).toBe(false);
    expect(hasSearchWord('E-Learning content development', 'e-learning')).toBe(true);
    expect(hasSearchWord('eLearning modules', 'e-learning')).toBe(true);
    expect(hasSearchWord('Machine learning platform', 'e-learning')).toBe(false);
    expect(hasSearchWord('Development of websites', 'website')).toBe(true);
    expect(hasSearchWord('Web site maintenance', 'website')).toBe(false);
    expect(hasSearchWord('Website maintenance', 'web site')).toBe(true);
  });

  it('ask GeM one plain word at a time, never quotes or hyphens', () => {
    expect(queryWordsFor('e-learning')).toEqual(['learning']);
    expect(queryWordsFor('"website development"')).toEqual(['website', 'development']);
  });

  it('keep real matches, drop GeM’s inside-a-word and department matches, and flag hidden ones', async () => {
    const { listPage } = fakeGem([
      bid(1, 'SEO and digital marketing services'),
      bid(2, 'Printer cartridge HP SEOLA 1802'),
      bid(3, 'Cab hiring service', { hidden: 'seo' }),
      bid(4, 'Annual maintenance of lifts', { department: 'Dept of SEO Affairs' }),
      bid(5, 'Silica gel', { hidden: 'eet.seo', createdBy: 'eet.seo' }),
    ]);
    const result = await findBidsWithWords(['SEO'], ['service', 'product'], listPage);
    expect(result.hits.map((hit) => [hit.bid.id, hit.visible])).toEqual([['1', true], ['3', false]]);
    expect(result.dropped).toBe(3);
  });

  it('search a phrase by its rarest word, and find bids that have the phrase', async () => {
    const many = Array.from({ length: 40 }, (_, i) => bid(100 + i, `Development of roads ${i}`));
    const { listPage, asked } = fakeGem([...many, bid(1, 'Website development and hosting'), bid(2, 'Website hosting only')]);
    const result = await findBidsWithWords(['website development'], ['service'], listPage);
    expect(result.hits.map((hit) => hit.bid.id)).toEqual(['1']);
    // The rarer word ("website", 2 bids) is read, not "development" (41 bids, 5 pages).
    expect(asked.filter((entry) => entry.startsWith('service:development')).length).toBe(1);
  });

  it('one bid with two search words is one hit naming both', async () => {
    const { listPage } = fakeGem([bid(1, 'SEO and website development')]);
    const result = await findBidsWithWords(['SEO', 'website development'], ['service'], listPage);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].words).toEqual(['SEO', 'website development']);
  });

  it('report a word too common to read in full', async () => {
    const lots = Array.from({ length: MAX_WORD_PAGES * 10 + 5 }, (_, i) => bid(i + 1, `Mobile app ${i}`));
    const { listPage } = fakeGem(lots);
    const result = await findBidsWithWords(['app'], ['service'], listPage);
    expect(result.tooCommon).toEqual([{ word: 'app', total: MAX_WORD_PAGES * 10 + 5 }]);
    expect(result.hits).toHaveLength(MAX_WORD_PAGES * 10);
  });
});
