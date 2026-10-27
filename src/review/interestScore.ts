import type { OpportunityLifecycle } from '../state/opportunityLifecycle.js';
import type { QualifyReport } from './qualifyCheck.js';
import type { ScreenedGate } from './tenderExplanation.js';
import { SimilarityIndex, type SimilarTender, type SimilarityMatch } from './tenderSimilarity.js';

// How well a tender fits the office's interest and scope, 0 to 100, with the
// reasons in plain words. It only ranks and explains: the KEEP / REJECT /
// UNCERTAIN decision of the checks (G1–G4), the sheets and Drive never
// depend on it (owner, 27 Oct 2026: borderline tenders show as "Low"
// instead of being lost, and Today lists the best fits first).

// The weights, in points. A tender starts at BASE; each signal adds or takes
// away. Picked so that a tender with your words in its title and in your
// category is High (25 + 35 + 10 = 70), with the words only in its details it
// is Medium (50), and without your words, or with an excluded word in the
// title, it is Low. History (looks like an approved tender, a buyer you
// approved or won from) lifts a good tender further; it never makes one.
export const INTEREST_WEIGHTS = {
  BASE: 25,
  INTENT_IN_TITLE: 35,
  INTENT_ONLY_IN_DETAILS: 15,
  IN_CATEGORY: 10,
  CHOSEN_ORGANISATION: 15,
  EXCLUDED_IN_TITLE: -35,
  EXCLUDED_IN_DETAILS: -10,
  /** For a match at or above SIMILAR_FULL; less in proportion, nothing below SIMILAR_MIN. */
  SIMILAR_MAX: 25,
  QUALIFY_MET: 10,
  QUALIFY_NOT_MET: -15,
  /** Closing within DAYS_VERY_FEW days (or closed): hardly time to prepare. */
  DAYS_VERY_FEW_LEFT: -20,
  DAYS_FEW_LEFT: -8,
  VALUE_USUAL: 5,
  VALUE_UNUSUAL: -5,
  BUYER_APPROVED_BEFORE: 10,
  BUYER_WON_BEFORE: 15,
} as const;

/** Cosine similarity below which two tenders are not called alike, and at which the full points are given. */
export const SIMILAR_MIN = 0.2;
export const SIMILAR_FULL = 0.6;
export const DAYS_VERY_FEW = 2;
export const DAYS_FEW = 5;
/** Approved tenders with a value needed before "the office's usual range" means anything. */
export const MIN_VALUES_FOR_RANGE = 5;

export const BAND_HIGH = 70;
export const BAND_MEDIUM = 40;

export type ScoreBand = 'HIGH' | 'MEDIUM' | 'LOW';

export const BAND_WORDS: Record<ScoreBand, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };

export interface ScoreReason {
  text: string;
  /** Signed points it added or took away. */
  points: number;
}

export interface InterestScore {
  score: number;
  band: ScoreBand;
  reasons: ScoreReason[];
  /** Approved or won tenders it looks like, most alike first. */
  similarTo: SimilarTender[];
}

/** The approved tenders' values, the middle of them (10th to 90th percentile), in rupees. */
export interface ValueRange {
  low: number;
  high: number;
}

export interface BuyerHistory {
  approved: number;
  won: number;
}

export interface InterestSignals {
  /** Your intent or search words in its title (or the portal's one-line work description). */
  intentInTitle: string[];
  /** Your words found only in its details page or bid document. */
  intentOnlyInDetails: string[];
  /** The chosen category it is in. */
  category: string | null;
  /** The chosen organisation it is from. */
  organisation: string | null;
  excludedInTitle: string[];
  excludedInDetails: string[];
  similarity: SimilarityMatch | null;
  /** "Do we qualify?"; null when the company's facts are not filled in. */
  qualify: QualifyReport | null;
  /** Days until it closes; null when the closing time is not known. */
  daysLeft: number | null;
  value: number | null;
  usualValues: ValueRange | null;
  buyer: BuyerHistory | null;
}

function quoted(values: readonly string[]): string {
  return values.map((value) => `“${value}”`).join(', ');
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function bandOf(score: number): ScoreBand {
  return score >= BAND_HIGH ? 'HIGH' : score >= BAND_MEDIUM ? 'MEDIUM' : 'LOW';
}

/** The score and its reasons from the signals; pure. */
export function interestScore(signals: InterestSignals): InterestScore {
  const weights = INTEREST_WEIGHTS;
  const reasons: ScoreReason[] = [];
  const add = (text: string, points: number) => reasons.push({ text, points });

  if (signals.intentInTitle.length) add(`Your words in the title: ${quoted(signals.intentInTitle)}`, weights.INTENT_IN_TITLE);
  else if (signals.intentOnlyInDetails.length) add(`Your words only in its details: ${quoted(signals.intentOnlyInDetails)}`, weights.INTENT_ONLY_IN_DETAILS);
  else add('None of your words in it', 0);

  if (signals.organisation) add(`From your organisation ${quoted([signals.organisation])}`, weights.CHOSEN_ORGANISATION);
  if (signals.category) add(`In your category ${quoted([signals.category])}`, weights.IN_CATEGORY);

  if (signals.excludedInTitle.length) add(`Excluded word in the title: ${quoted(signals.excludedInTitle)}`, weights.EXCLUDED_IN_TITLE);
  else if (signals.excludedInDetails.length) add(`Excluded word in its details: ${quoted(signals.excludedInDetails)}`, weights.EXCLUDED_IN_DETAILS);

  const similarTo = signals.similarity && signals.similarity.best >= SIMILAR_MIN
    ? signals.similarity.similar.filter((tender) => tender.similarity >= SIMILAR_MIN)
    : [];
  if (similarTo.length) {
    const points = Math.round(weights.SIMILAR_MAX * Math.min(1, similarTo[0].similarity / SIMILAR_FULL));
    const title = similarTo[0].title.length > 70 ? `${similarTo[0].title.slice(0, 67).trimEnd()}…` : similarTo[0].title;
    add(`Looks like “${title}”, which you approved`, points);
  }

  const qualify = signals.qualify;
  if (qualify?.profileFilled && qualify.checks.length > 0) {
    if (qualify.notMet > 0) add(`You may not meet ${qualify.notMet} of ${qualify.checks.length} criteria`, weights.QUALIFY_NOT_MET);
    else if (qualify.met > 0) add(qualify.toCheck > 0 ? `You meet ${qualify.met} criteria; ${qualify.toCheck} to check` : 'You meet its criteria', weights.QUALIFY_MET);
  }

  if (signals.daysLeft !== null) {
    if (signals.daysLeft < 0) add('Already closed', weights.DAYS_VERY_FEW_LEFT);
    else if (signals.daysLeft < DAYS_VERY_FEW) add(signals.daysLeft < 1 ? 'Closes within a day' : 'Only 1 day left to prepare', weights.DAYS_VERY_FEW_LEFT);
    else if (signals.daysLeft < DAYS_FEW) add(`Only ${Math.floor(signals.daysLeft)} days left to prepare`, weights.DAYS_FEW_LEFT);
  }

  if (signals.value !== null && signals.usualValues) {
    const { low, high } = signals.usualValues;
    if (signals.value >= low / 2 && signals.value <= high * 2) add('Value in your usual range', weights.VALUE_USUAL);
    else if (signals.value > high * 5) add('Much larger than the tenders you usually approve', weights.VALUE_UNUSUAL);
    else if (signals.value < low / 5) add('Much smaller than the tenders you usually approve', weights.VALUE_UNUSUAL);
  }

  if (signals.buyer?.won) add(`You won ${signals.buyer.won === 1 ? 'a tender' : plural(signals.buyer.won, 'tender')} from this buyer before`, weights.BUYER_WON_BEFORE);
  else if (signals.buyer?.approved) add(`You approved ${plural(signals.buyer.approved, 'tender')} from this buyer before`, weights.BUYER_APPROVED_BEFORE);

  const score = Math.max(0, Math.min(100, weights.BASE + reasons.reduce((sum, reason) => sum + reason.points, 0)));
  return { score, band: bandOf(score), reasons, similarTo };
}

// ---------- What the office approved before ----------

/** Lifecycles of tenders the operator approved, whatever happened to the bid after (as bidResults counts them). */
export const APPROVED_BEFORE_LIFECYCLES: readonly OpportunityLifecycle[] = [
  'APPROVED', 'DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'PREPARING', 'SUBMITTED', 'NOT_SUBMITTED', 'WON', 'LOST',
];

export interface ApprovedTender {
  id: string;
  title: string;
  /** Its work description, when the details page was read. */
  description?: string | null;
  lifecycle: OpportunityLifecycle;
  organisation: string | null;
  department: string | null;
  value: string | null;
}

export interface InterestHistory {
  similarity: SimilarityIndex;
  buyers: Map<string, BuyerHistory>;
  usualValues: ValueRange | null;
  /** Each approved tender's lifecycle, so a tender is never its own history. */
  lifecycles: Map<string, OpportunityLifecycle>;
}

function words(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The same buyer: the whole organisation chain and department, ignoring case and punctuation. */
export function buyerKey(organisation: string | null, department: string | null): string {
  return [organisation ?? '', department ?? ''].join('||').split('||').map(words).filter(Boolean).join('|');
}

/** Rupees from a stored value ("1,50,000.00", "₹ 2500000"); null for "NA", blank or nothing usable. */
export function rupeesOf(raw: string | null | undefined): number | null {
  const cleaned = (raw ?? '').replace(/[,₹]/g, '').trim().replace(/^(?:rs\.?|inr)\s*/i, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))];
}

export function buildInterestHistory(approved: readonly ApprovedTender[]): InterestHistory {
  const buyers = new Map<string, BuyerHistory>();
  for (const tender of approved) {
    const key = buyerKey(tender.organisation, tender.department);
    if (!key) continue;
    const buyer = buyers.get(key) ?? { approved: 0, won: 0 };
    buyer.approved += 1;
    if (tender.lifecycle === 'WON') buyer.won += 1;
    buyers.set(key, buyer);
  }
  const values = approved.map((tender) => rupeesOf(tender.value)).filter((value): value is number => value !== null).sort((a, b) => a - b);
  return {
    similarity: new SimilarityIndex(approved.map((tender) => ({ id: tender.id, title: tender.title, text: tender.description }))),
    buyers,
    lifecycles: new Map(approved.map((tender) => [tender.id, tender.lifecycle])),
    usualValues: values.length >= MIN_VALUES_FOR_RANGE ? { low: percentile(values, 0.1), high: percentile(values, 0.9) } : null,
  };
}

/**
 * The history, built again only when the approved tenders change (one
 * approved, won, or seen again): building reads every approved tender's
 * work description, which Today should not do on every decision.
 */
export class InterestHistoryCache {
  private key: string | null = null;
  private history: InterestHistory | null = null;

  get(rows: ReadonlyArray<{ id: string; lifecycle: string; updated_at: string }>, load: () => ApprovedTender[]): InterestHistory {
    const key = rows.map((row) => `${row.id}:${row.lifecycle}:${row.updated_at}`).sort().join('|');
    if (this.history && key === this.key) return this.history;
    this.history = buildInterestHistory(load());
    this.key = key;
    return this.history;
  }
}

// ---------- One tender's signals ----------

export interface TenderInterestInput {
  id: string;
  title: string;
  /** The portal's one-line work description, which counts as title text. */
  description?: string | null;
  /** The gates of its latest screening. */
  gates: readonly ScreenedGate[];
  /** The chosen organisation it is from, if any. */
  favouredOrganisation?: string | null;
  organisation: string | null;
  department: string | null;
  /** UTC ISO. */
  closingAt: string | null;
  value: string | null;
  qualify?: QualifyReport | null;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

function containsPhrase(text: string, phrase: string): boolean {
  const needle = words(phrase);
  return needle !== '' && ` ${words(text)} `.includes(` ${needle} `);
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The signals of one tender, from its screening and what the office approved before. */
export function interestSignals(input: TenderInterestInput, history: InterestHistory | null, now: Date): InterestSignals {
  const byGate = (id: ScreenedGate['gate']) => input.gates.find((gate) => gate.gate === id);
  const titleText = `${input.title} ${input.description ?? ''}`;
  // GeM's search words count as your words, like the intent words.
  const found = unique([...list(byGate('G3')?.evidence.matchedKeywords), ...list(byGate('G2')?.evidence.searchWords)]);
  const excluded = unique(input.gates.flatMap((gate) => list(gate.evidence.matchedExcludedKeywords)));
  const category = byGate('G2')?.result === 'PASS' ? list(byGate('G2')?.evidence.matched)[0] ?? null : null;
  const gateOrganisation = byGate('G2')?.evidence.organisation;
  const closing = input.closingAt ? Date.parse(input.closingAt) : Number.NaN;
  const recorded = history?.buyers.get(buyerKey(input.organisation, input.department)) ?? null;
  // An approved tender on the day sheet: its buyer's history without itself.
  const own = history?.lifecycles.get(input.id);
  const buyer = recorded && own ? { approved: recorded.approved - 1, won: recorded.won - (own === 'WON' ? 1 : 0) } : recorded;
  return {
    intentInTitle: found.filter((word) => containsPhrase(titleText, word)),
    intentOnlyInDetails: found.filter((word) => !containsPhrase(titleText, word)),
    category,
    organisation: input.favouredOrganisation ?? (typeof gateOrganisation === 'string' ? gateOrganisation : null),
    excludedInTitle: excluded.filter((word) => containsPhrase(titleText, word)),
    excludedInDetails: excluded.filter((word) => !containsPhrase(titleText, word)),
    similarity: history && history.similarity.size > 0 ? history.similarity.match(titleText, { excludeId: input.id }) : null,
    qualify: input.qualify ?? null,
    daysLeft: Number.isNaN(closing) ? null : (closing - now.getTime()) / 86_400_000,
    value: rupeesOf(input.value),
    usualValues: history?.usualValues ?? null,
    buyer,
  };
}

/** A tender's fit: its signals, scored. */
export function tenderInterest(input: TenderInterestInput, history: InterestHistory | null = null, now = new Date()): InterestScore {
  return interestScore(interestSignals(input, history, now));
}

/** "High (82)", for the day sheet and the decide screen. */
export function fitLabel(score: Pick<InterestScore, 'score' | 'band'>): string {
  return `${BAND_WORDS[score.band]} (${score.score})`;
}
