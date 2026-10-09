// Websites rename and drop Product Categories (Tamil Nadu's "Information
// Technology", 9 Oct 2026). Each read of a website's list is remembered per
// category (first and last seen), so TenderAssist can say which chosen
// categories are gone, since when, which ones are new, and what to search
// instead. A missing category is never removed by itself: it may come back.

/** When a category was first and last on the website's list. ISO times. */
export interface CategorySighting { firstSeen: string; lastSeen: string }

export type CategoryHistory = Record<string, CategorySighting>;

/** After this long off the website's list, Settings suggests removing a chosen category. */
export const LONG_GONE_DAYS = 14;

const DAY_MS = 86_400_000;

export const categoryKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLocaleLowerCase();

/** The history after one more read of the list: everything on it was seen at `readAt`. */
export function mergeCategoryHistory(previous: CategoryHistory | undefined, categories: readonly string[], readAt: string): CategoryHistory {
  const next: CategoryHistory = { ...(previous ?? {}) };
  for (const name of categories) {
    const key = categoryKey(name);
    const before = next[key];
    next[key] = { firstSeen: before?.firstSeen ?? readAt, lastSeen: readAt };
  }
  return next;
}

export interface MissingCategory {
  name: string;
  /** Last read of the list that had it; null when no read since history began had it. */
  lastSeen: string | null;
  /** Off the list for LONG_GONE_DAYS or more: suggest removing it. */
  longGone: boolean;
}

export interface CategoryHealthInput {
  categories: readonly string[];
  readAt: string | null;
  history?: CategoryHistory;
  /** The first read that kept history; categories first seen then are not "new". */
  historySince?: string | null;
  /** When the operator last looked at the new categories. */
  newLookedAt?: string | null;
}

export interface CategoryHealth {
  /** When the list these answers come from was read; null before any read. */
  readAt: string | null;
  missing: MissingCategory[];
  /** On the website now, first seen after the operator last looked, and not chosen. */
  newOnWebsite: string[];
}

export function categoryHealth(list: CategoryHealthInput, chosen: readonly string[], now = new Date()): CategoryHealth {
  if (list.categories.length === 0 || !list.readAt) return { readAt: list.readAt, missing: [], newOnWebsite: [] };
  const onList = new Set(list.categories.map(categoryKey));
  const chosenKeys = new Set(chosen.map(categoryKey));
  const missing = chosen.filter((name) => !onList.has(categoryKey(name))).map((name): MissingCategory => {
    const lastSeen = list.history?.[categoryKey(name)]?.lastSeen ?? null;
    // Never seen: count from when TenderAssist started keeping the history.
    const goneSince = Date.parse(lastSeen ?? list.historySince ?? list.readAt!);
    return { name, lastSeen, longGone: now.getTime() - goneSince >= LONG_GONE_DAYS * DAY_MS };
  });
  const since = [list.historySince, list.newLookedAt].filter((value): value is string => Boolean(value)).sort().pop();
  const newOnWebsite = since
    ? list.categories.filter((name) => {
      const firstSeen = list.history?.[categoryKey(name)]?.firstSeen;
      return firstSeen !== undefined && firstSeen > since && !chosenKeys.has(categoryKey(name));
    })
    : [];
  return { readAt: list.readAt, missing, newOnWebsite };
}

/** A past tender, as evidence of where the office's kind of work is listed. */
export interface CategoryEvidence {
  /** The category the search found it under. */
  category: string | null;
  /** The category the tender's own page states, when read; it can differ. */
  detailCategory: string | null;
  /** Approved by the operator, or kept by TenderAssist. */
  wanted: boolean;
}

export interface CategorySuggestion {
  name: string;
  /** Why it is suggested, strongest first, in plain words. */
  reasons: string[];
  score: number;
}

export interface ReplacementAdvice {
  /** What the missing category used to bring in. */
  missing: { name: string; found: number; wanted: number };
  suggestions: CategorySuggestion[];
}

const STOP_WORDS = new Set(['and', 'of', 'the', 'for', 'or', 'other', 'others', 'related', 'items', 'item', 'works', 'work', 'goods', 'services', 'service']);
const words = (name: string) => new Set(name.toLocaleLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word)));

/** Shares a word, or one name's word starts the other's ("Info." and "Information"). */
function sharedWords(a: string, b: string): number {
  const left = words(a);
  let shared = 0;
  for (const word of words(b)) {
    if ([...left].some((other) => other === word || (Math.min(other.length, word.length) >= 3 && (other.startsWith(word) || word.startsWith(other))))) shared += 1;
  }
  return shared;
}

/**
 * What to search instead of a category the website dropped. The tenders
 * speak louder than the names: categories where the office's approved or
 * kept tenders were listed come first, then categories that appeared when
 * this one went (a likely rename), then similar names.
 */
export function suggestReplacements(
  list: CategoryHealthInput,
  missingName: string,
  chosen: readonly string[],
  evidence: readonly CategoryEvidence[],
  limit = 8,
): ReplacementAdvice {
  const chosenKeys = new Set(chosen.map(categoryKey));
  const missingKey = categoryKey(missingName);
  const lastSeen = list.history?.[missingKey]?.lastSeen ?? null;

  const wantedIn = new Map<string, number>();
  let found = 0;
  let wanted = 0;
  for (const tender of evidence) {
    if (tender.category && categoryKey(tender.category) === missingKey) {
      found += 1;
      if (tender.wanted) wanted += 1;
    }
    if (!tender.wanted) continue;
    const named = new Set([tender.category, tender.detailCategory].filter((name): name is string => Boolean(name)).map(categoryKey));
    for (const key of named) wantedIn.set(key, (wantedIn.get(key) ?? 0) + 1);
  }

  const suggestions: CategorySuggestion[] = [];
  for (const name of list.categories) {
    const key = categoryKey(name);
    if (chosenKeys.has(key) || key === missingKey) continue;
    const reasons: string[] = [];
    let score = 0;
    const tenders = wantedIn.get(key) ?? 0;
    if (tenders > 0) {
      score += 100 + tenders * 10;
      reasons.push(`${tenders} ${tenders === 1 ? 'tender' : 'tenders'} you wanted ${tenders === 1 ? 'was' : 'were'} listed here`);
    }
    const firstSeen = list.history?.[key]?.firstSeen;
    const historySince = list.historySince ?? null;
    if (firstSeen && historySince && firstSeen > historySince && (!lastSeen || firstSeen > lastSeen)) {
      score += 50;
      reasons.push('New on the website since it went: may be its new name');
    }
    const shared = sharedWords(missingName, name);
    if (shared > 0) {
      score += shared * 20;
      reasons.push('Similar name');
    }
    if (score > 0) suggestions.push({ name, reasons, score });
  }
  suggestions.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { missing: { name: missingName, found, wanted }, suggestions: suggestions.slice(0, limit) };
}
