// The operator's GeM search words ("SEO", "website development",
// "e-learning"): every open bid that has one, whatever its day or category.
//
// GeM's own search box is fast but loose (checked 13 Oct 2026,
// docs/gem-portal.md): it matches inside words ("seo" finds "HP SEOLA"),
// in the buyer's department ("engine" finds "Engineering"), and in text its
// list does not show; word order changes its results, and hyphens and quotes
// break it ("e-learning" finds nothing). Its pages, sorted by start date, are
// stable. So GeM is asked for one plain word at a time, and every bid it
// returns is checked here: the search word must be in the bid's title,
// category or items as whole words.

import type { GemBid } from './gemBid.js';
import type { GemBidType, GemListPage } from './gemClient.js';

const PAGE_SIZE = 10;
/** The most pages read for one word and bid type; a word with more bids is too common to search this way. */
export const MAX_WORD_PAGES = 50;

const WORD_CHARS = /[\p{L}\p{N}]+/gu;

function tokens(phrase: string): string[] {
  return phrase.toLocaleLowerCase().match(WORD_CHARS) ?? [];
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The search word as a pattern over whole words: "e-learning" also matches
 * "elearning" and "e learning", "web site" matches "website", and a plural
 * ("websites") counts.
 */
export function searchWordPattern(phrase: string): RegExp | null {
  const parts = tokens(phrase);
  if (parts.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.map(escape).join('[\\s\\-_/.&]*')}(?:e?s)?(?![\\p{L}\\p{N}])`, 'iu');
}

export function hasSearchWord(text: string, phrase: string): boolean {
  return searchWordPattern(phrase)?.test(text) ?? false;
}

/** What the operator sees of a bid in GeM's list: where a search word must be. */
export function visibleBidText(bid: Pick<GemBid, 'title' | 'itemName' | 'category'>): string {
  return `${bid.title} ${bid.itemName} ${bid.category}`;
}

/**
 * The words to ask GeM for: each plain word of the phrase of two letters or
 * more. GeM's box matches inside words, so any one of them finds every bid
 * with the phrase; the one with the fewest bids is used (`pickQueryWord`).
 */
export function queryWordsFor(phrase: string): string[] {
  return [...new Set(tokens(phrase).filter((token) => token.length >= 2))];
}

export interface SearchWordHit {
  bid: GemBid;
  /** The operator's search words this bid has. */
  words: string[];
  /**
   * True when a word is in the bid's title, category or items. False when GeM
   * returned it for the word but the word is nowhere the list shows (GeM also
   * searches text it does not list): the bid document, which has every detail
   * of the bid, decides.
   */
  visible: boolean;
}

export interface WordSearchResult {
  hits: SearchWordHit[];
  /** Words with more bids on GeM than can be read for them; only the newest were checked. */
  tooCommon: Array<{ word: string; total: number }>;
  /** Bids GeM returned that do not have the word (inside another word, or only in a department name). */
  dropped: number;
}

export type KeywordListPage = (query: { keyword: string; bidType: GemBidType; page: number }) => Promise<GemListPage>;

/** The plain word of a phrase with the fewest bids on GeM (one first page each), and its count. */
async function pickQueryWord(phrase: string, bidType: GemBidType, listPage: KeywordListPage): Promise<{ word: string; first: GemListPage } | null> {
  let best: { word: string; first: GemListPage } | null = null;
  for (const word of queryWordsFor(phrase)) {
    const first = await listPage({ keyword: word, bidType, page: 1 });
    if (!best || first.total < best.first.total) best = { word, first };
    if (first.total === 0) break;
  }
  return best;
}

/**
 * Every open GeM bid with one of the search words, checked word by word.
 * A bid GeM returns is kept when the word is in its title, category or
 * items; dropped when the plain word GeM was asked for shows only inside
 * another word or in the buyer's name or user ID; and kept as "not visible" when the
 * word is nowhere GeM's list shows (GeM matched text it does not list).
 */
export async function findBidsWithWords(
  phrases: readonly string[],
  bidTypes: readonly GemBidType[],
  listPage: KeywordListPage,
  onProgress?: (progress: { word: string; found: number }) => void,
  maxPages = MAX_WORD_PAGES,
): Promise<WordSearchResult> {
  const hits = new Map<string, SearchWordHit>();
  const tooCommon: WordSearchResult['tooCommon'] = [];
  let dropped = 0;
  for (const phrase of phrases) {
    if (!searchWordPattern(phrase)) continue;
    for (const bidType of bidTypes) {
      const picked = await pickQueryWord(phrase, bidType, listPage);
      if (!picked || picked.first.total === 0) continue;
      const pages = Math.ceil(picked.first.total / PAGE_SIZE);
      if (pages > maxPages) tooCommon.push({ word: phrase, total: picked.first.total });
      for (let page = 1; page <= Math.min(pages, maxPages); page += 1) {
        const result = page === 1 ? picked.first : await listPage({ keyword: picked.word, bidType, page });
        for (const bid of result.bids) {
          if (bid.cancelled) continue;
          const visibleText = visibleBidText(bid);
          const visible = hasSearchWord(visibleText, phrase);
          if (!visible && `${visibleText} ${bid.ministry ?? ''} ${bid.department ?? ''} ${bid.createdBy ?? ''}`.toLocaleLowerCase().includes(picked.word)) {
            dropped += 1;
            continue;
          }
          const hit = hits.get(bid.id);
          if (hit) {
            if (!hit.words.includes(phrase)) hit.words.push(phrase);
            hit.visible ||= visible;
          } else {
            hits.set(bid.id, { bid, words: [phrase], visible });
          }
        }
        onProgress?.({ word: phrase, found: hits.size });
        if (result.bids.length === 0) break;
      }
    }
  }
  return { hits: [...hits.values()], tooCommon, dropped };
}
