import type { OpportunityRow } from '../persistence/repositories/opportunityRepository.js';

// Suggests that a tender with a new Tender ID may be a retender of an older
// one. It is only a hint for the operator: tenders are never merged, because
// a new Tender ID is a new tender on the portal.

export type RetenderReason = 'SAME_REFERENCE' | 'SIMILAR_TITLE';

type Comparable = Pick<OpportunityRow, 'portal_id' | 'identity_key' | 'tender_ref' | 'title' | 'department' | 'organisation_chain'>;

const MIN_TITLE_WORDS = 5;
const MIN_TITLE_SIMILARITY = 0.9;

// Words that mark a retender rather than describe the work.
const RETENDER_WORDS = [
  /\bre[\s-]?tender(?:ed|ing)?\b/g,
  /\bre[\s-]?invit(?:ed|ation)\b/g,
  /\b(?:\d+(?:st|nd|rd|th)|second|third|fourth|fifth)\s+call\b/g,
  /\bcall\s*(?:no\.?\s*)?\d+\b/g,
];

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase();
}

function meaningfulReference(value: string | null | undefined): string | null {
  const normalized = normalize(value);
  if (normalized.length < 4 || normalized === 'NA' || normalized === 'N/A') return null;
  return normalized;
}

export function titleWords(title: string): Set<string> {
  let text = title.toLocaleLowerCase();
  for (const pattern of RETENDER_WORDS) text = text.replace(pattern, ' ');
  return new Set(text.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2));
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** A tender's matching facts, worked out once. */
interface Prepared<T extends Comparable> {
  row: T;
  reference: string | null;
  department: string;
  organisation: string;
  words: Set<string>;
}

function prepare<T extends Comparable>(row: T): Prepared<T> {
  return {
    row,
    reference: meaningfulReference(row.tender_ref),
    department: normalize(row.department),
    organisation: normalize(row.organisation_chain),
    words: titleWords(row.title),
  };
}

function reasonBetween(a: Prepared<Comparable>, b: Prepared<Comparable>): RetenderReason | null {
  if (a.row.portal_id !== b.row.portal_id || a.row.identity_key === b.row.identity_key) return null;
  if (a.reference && a.reference === b.reference) return 'SAME_REFERENCE';
  const sameBuyer = (a.department && a.department === b.department) || (a.organisation && a.organisation === b.organisation);
  if (!sameBuyer) return null;
  const smaller = Math.min(a.words.size, b.words.size);
  if (smaller < MIN_TITLE_WORDS) return null;
  // Shared words cannot exceed the smaller title, so titles of very different length never reach the bar.
  if (smaller / Math.max(a.words.size, b.words.size) < MIN_TITLE_SIMILARITY) return null;
  return similarity(a.words, b.words) >= MIN_TITLE_SIMILARITY ? 'SIMILAR_TITLE' : null;
}

/** Why two tenders look related, or null. Same Tender ID is identity, not a retender. */
export function retenderReason(a: Comparable, b: Comparable): RetenderReason | null {
  return reasonBetween(prepare(a), prepare(b));
}

/**
 * Every pair of `rows` that look related, where at least one of the pair is
 * in `focusIds`; each pair once. Only tenders that share a reference or a
 * buyer are compared, so thousands of tenders take moments, not minutes.
 */
export function possibleRetenderPairs<T extends Comparable & { id: string }>(rows: readonly T[], focusIds: Iterable<string>): Array<[T, T]> {
  const prepared = new Map(rows.map((row) => [row.id, prepare(row)]));
  const buckets = new Map<string, Prepared<T>[]>();
  const add = (key: string, entry: Prepared<T>) => {
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry); else buckets.set(key, [entry]);
  };
  for (const entry of prepared.values()) {
    if (entry.reference) add(`r:${entry.reference}`, entry);
    if (entry.department) add(`d:${entry.department}`, entry);
    if (entry.organisation) add(`o:${entry.organisation}`, entry);
  }
  const pairs: Array<[T, T]> = [];
  // A focus tender already done has met every tender it shares a bucket with.
  const finished = new Set<Prepared<T>>();
  for (const id of focusIds) {
    const current = prepared.get(id);
    if (!current || finished.has(current)) continue;
    const met = new Set<Prepared<T>>([current]);
    const keys = [
      current.reference && `r:${current.reference}`,
      current.department && `d:${current.department}`,
      current.organisation && `o:${current.organisation}`,
    ];
    for (const key of keys) {
      if (!key) continue;
      for (const other of buckets.get(key) ?? []) {
        if (met.has(other) || finished.has(other)) continue;
        met.add(other);
        if (reasonBetween(current, other)) pairs.push([current.row, other.row]);
      }
    }
    finished.add(current);
  }
  return pairs;
}

export const RETENDER_REASON_TEXT: Record<RetenderReason, string> = {
  SAME_REFERENCE: 'same reference number',
  SIMILAR_TITLE: 'near-identical title from the same department',
};
