// Suggests intent and excluded words from the operator's own decisions:
// phrases that keep turning up in tenders they approved but not in ones they
// rejected, and the other way round. Nothing is added automatically.

export interface WordSuggestion {
  phrase: string;
  approved: number;
  rejected: number;
  /** Plain reason, e.g. "in 6 approved, 0 rejected". */
  reason: string;
}

export interface WordSuggestions {
  intent: WordSuggestion[];
  excluded: WordSuggestion[];
}

export interface DecidedTenderText {
  title: string;
  /** The portal's work description, when the details page was read. */
  description: string | null;
}

export interface SuggestionInput {
  approved: DecidedTenderText[];
  rejected: DecidedTenderText[];
  keywords: string[];
  excludedKeywords: string[];
  /** A phrase must appear in at least this many tenders on its side. */
  minTenders?: number;
  limit?: number;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or',
  'the', 'to', 'with', 'within', 'under', 'via', 'per', 'all', 'other', 'etc', 'no', 'not', 'this', 'that', 'year', 'years',
  // Words in almost every tender, which say nothing about the work.
  'tender', 'tenders', 'supply', 'work', 'works', 'department', 'district', 'office', 'government', 'govt', 'tamil', 'nadu',
  'chennai', 'state', 'name', 'providing', 'provision', 'various', 'item', 'items', 'nos', 'lot', 'invited', 'bid', 'bids',
  'rate', 'contract', 'period', 'basis', 'regarding', 'reg', 'ref', 'description', 'title',
  // GeM's form wording in bid titles ("Custom Bid for Services", "Service Provider Premises; Yes; Buyer Premises").
  'custom', 'yes', 'buyer', 'buyers', 'seller', 'sellers', 'premises', 'provider', 'service', 'services', 'product', 'products',
  'consignee', 'onsite', 'offsite', 'location', 'locations', 'quantity', 'qty', 'unit', 'units', 'option', 'options', 'required',
]);

/**
 * The part of a title that names the work. GeM titles start with "Custom
 * Bid for Services - " and list the bid's form answers after the first ";"
 * (make, place, "Yes", "Buyer Premises"); neither says what the work is.
 */
export function workPartOfTitle(title: string): string {
  return title
    .replace(/^\s*custom bid for (?:services|products?)\s*-\s*/i, '')
    .split(';')[0]
    .trim();
}

const MAX_PHRASE_WORDS = 3;

function words(text: string): string[] {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

function usefulWord(word: string): boolean {
  return word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word);
}

/** Every 1–3 word phrase in the text that starts and ends on a meaningful word. */
function phrasesIn(text: string): Set<string> {
  const tokens = words(text);
  const found = new Set<string>();
  for (let start = 0; start < tokens.length; start += 1) {
    if (!usefulWord(tokens[start])) continue;
    for (let length = 1; length <= MAX_PHRASE_WORDS && start + length <= tokens.length; length += 1) {
      const last = tokens[start + length - 1];
      if (!usefulWord(last)) continue;
      found.add(tokens.slice(start, start + length).join(' '));
    }
  }
  return found;
}

function countTenders(texts: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) for (const phrase of phrasesIn(text)) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  return counts;
}

/** True when the phrase is already one of the operator's words, or part of one, or contains one. */
function alreadyCovered(phrase: string, existing: string[]): boolean {
  const padded = ` ${phrase} `;
  return existing.some((word) => {
    const normal = words(word).join(' ');
    return normal !== '' && (padded.includes(` ${normal} `) || ` ${normal} `.includes(padded));
  });
}

function pick(
  side: Map<string, number>,
  other: Map<string, number>,
  existing: string[],
  minTenders: number,
  limit: number,
  label: (count: number, otherCount: number) => string,
  asApproved: boolean
): WordSuggestion[] {
  const candidates = [...side.entries()]
    .map(([phrase, count]) => ({ phrase, count, otherCount: other.get(phrase) ?? 0 }))
    // Clearly one-sided: at least `minTenders` here, and at most one in four on the other side.
    .filter((item) => item.count >= minTenders && item.otherCount * 4 <= item.count)
    .filter((item) => !alreadyCovered(item.phrase, existing));
  // A shorter phrase that only ever appears inside a longer suggestion adds nothing.
  const kept = candidates.filter((item) => !candidates.some((longer) =>
    longer.phrase !== item.phrase && longer.count === item.count && longer.otherCount === item.otherCount
    && ` ${longer.phrase} `.includes(` ${item.phrase} `)));
  kept.sort((a, b) => (b.count - 2 * b.otherCount) - (a.count - 2 * a.otherCount)
    || b.phrase.split(' ').length - a.phrase.split(' ').length
    || a.phrase.localeCompare(b.phrase));
  return kept.slice(0, limit).map((item) => ({
    phrase: item.phrase,
    approved: asApproved ? item.count : item.otherCount,
    rejected: asApproved ? item.otherCount : item.count,
    reason: label(item.count, item.otherCount),
  }));
}

export function suggestWords(input: SuggestionInput): WordSuggestions {
  const minTenders = input.minTenders ?? 3;
  const limit = input.limit ?? 8;
  const existing = [...input.keywords, ...input.excludedKeywords];
  // Intent words are matched against the whole tender, so read title and description.
  const fullText = (tender: DecidedTenderText) => [workPartOfTitle(tender.title), tender.description].filter(Boolean).join(' . ');
  const approvedFull = countTenders(input.approved.map(fullText));
  const rejectedFull = countTenders(input.rejected.map(fullText));
  // Excluded words are matched against titles only, so suggest them from titles.
  const approvedTitles = countTenders(input.approved.map((tender) => workPartOfTitle(tender.title)));
  const rejectedTitles = countTenders(input.rejected.map((tender) => workPartOfTitle(tender.title)));
  return {
    intent: pick(approvedFull, rejectedFull, existing, minTenders, limit,
      (count, other) => `in ${count} approved, ${other} rejected`, true),
    // Excluded words reject without reading the tender, so only phrases: one word
    // ("installation") would also reject the office's own work ("installation of software").
    excluded: pick(new Map([...rejectedTitles].filter(([phrase]) => phrase.includes(' '))), approvedTitles, existing, minTenders, limit,
      (count, other) => `in ${count} rejected titles, ${other} approved`, false),
  };
}

/** The portal's "Work Description" value from a tender's saved detail text. */
export function workDescriptionFrom(detailText: string | null): string | null {
  if (!detailText) return null;
  const line = detailText.split('\n').find((text) => /^\s*work description\s*:/i.test(text));
  const value = line?.replace(/^\s*work description\s*:/i, '').trim();
  return value || null;
}
