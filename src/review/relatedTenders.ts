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

function sameBuyer(a: Comparable, b: Comparable): boolean {
  const department = normalize(a.department);
  if (department && department === normalize(b.department)) return true;
  const organisation = normalize(a.organisation_chain);
  return Boolean(organisation) && organisation === normalize(b.organisation_chain);
}

/** Why two tenders look related, or null. Same Tender ID is identity, not a retender. */
export function retenderReason(a: Comparable, b: Comparable): RetenderReason | null {
  if (a.portal_id !== b.portal_id || a.identity_key === b.identity_key) return null;
  const reference = meaningfulReference(a.tender_ref);
  if (reference && reference === meaningfulReference(b.tender_ref)) return 'SAME_REFERENCE';
  if (!sameBuyer(a, b)) return null;
  const wordsA = titleWords(a.title);
  const wordsB = titleWords(b.title);
  if (Math.min(wordsA.size, wordsB.size) < MIN_TITLE_WORDS) return null;
  return similarity(wordsA, wordsB) >= MIN_TITLE_SIMILARITY ? 'SIMILAR_TITLE' : null;
}

export const RETENDER_REASON_TEXT: Record<RetenderReason, string> = {
  SAME_REFERENCE: 'same reference number',
  SIMILAR_TITLE: 'near-identical title from the same department',
};
