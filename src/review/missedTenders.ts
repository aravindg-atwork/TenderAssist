import { categoriesForPortal, chosenOrganisationOf, organisationsForPortal, type RunDefaults } from '../config/runConfiguration.js';
import { evaluateExcludedScope, evaluateTenderIntent } from '../classification/intentGates.js';
import type { ScreenedGate } from './tenderExplanation.js';
import { conflictNote } from './wordFamilies.js';
import { workPartOfTitle } from './wordSuggestions.js';
import { matchKey, workPhrasesIn } from './workPhrases.js';

// Why TenderAssist's own rules missed a tender the operator wanted (one they
// added to My Tenders by hand, or approved after TenderAssist rejected it),
// and the one change to Settings that would have kept it. Each fix is only
// offered; the operator applies it in Settings like any other change.

export interface MissedTender {
  portalId: string;
  /** "Tamil Nadu", "GeM": for "Add category … for Tamil Nadu". */
  portalName: string;
  portalKind?: string;
  title: string;
  /** The portal's one-line "Work Description", which counts like the title. */
  workDescription: string | null;
  /** The details page or bid document text, where only phrases count. */
  details: string;
  /** The organisation it came from, as the website names it. */
  organisation: string | null;
  /** The saved checks from its SCREENED event (parseScreenedGates). */
  gates: ScreenedGate[];
  /** Added to My Tenders on the website by hand, not approved after a reject. */
  addedByHand: boolean;
  /** The run that read it, and when the operator's choice was recorded. */
  jobId: string | null;
  approvedAt: string;
}

export type MissedFix =
  | { kind: 'ADD_CATEGORY'; portalId: string; category: string }
  | { kind: 'ADD_ORGANISATION'; portalId: string; organisation: string }
  | { kind: 'ADD_INTENT_WORD'; phrase: string }
  | { kind: 'REVIEW_EXCLUDED_WORD'; word: string };

export interface MissedSuggestion {
  /** Stable across refreshes, for remembering a "keep it". */
  key: string;
  fix: MissedFix;
  /** What selecting it does: "Add category “Computer- H/W” for Tamil Nadu". */
  label: string;
  /** Why: "Missed 2 tenders you wanted: “web portal” was in both titles." */
  reason: string;
  note?: string;
  tenders: number;
  /** Up to three of the tenders' titles. */
  titles: string[];
}

export interface MissedTendersView {
  /** Wanted tenders in the window that a rule turned down. */
  missed: number;
  suggestions: MissedSuggestion[];
  /** The latest run that read tenders the operator added by hand, and how many of those a rule missed. */
  latestRun: { jobId: string; addedByHand: number; missed: number } | null;
}

/** What turned one wanted tender down, judged by today's settings. */
export interface MissReasons {
  /** Its category, when that is not chosen and its organisation is not either. */
  category: string | null;
  organisation: string | null;
  /** True when none of today's intent words matches it. */
  noIntentWord: boolean;
  /** Phrases from its title that would, best first. */
  phrases: string[];
  /** Today's excluded words that reject it. */
  excludedWords: string[];
}

export const MISSED_WINDOW_DAYS = 60;
const PHRASES_PER_TENDER = 3;
const MAX_INTENT_SUGGESTIONS = 5;

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

const tendersCount = (count: number) => `${count} ${count === 1 ? 'tender' : 'tenders'}`;
const quoted = (value: string) => `“${value}”`;
const sameText = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * The reasons a rule missed this tender. A check counts only when it turned
 * the tender down at the time and would still do so with today's settings:
 * one fixed since is not offered again.
 */
export function whyMissed(tender: MissedTender, defaults: RunDefaults): MissReasons {
  const gate = (id: ScreenedGate['gate']) => tender.gates.find((item) => item.gate === id);
  const reasons: MissReasons = { category: null, organisation: null, noIntentWord: false, phrases: [], excludedWords: [] };

  const category = gate('G2');
  const actual = list(category?.evidence.actual);
  if (category?.result === 'REJECT' && actual.length > 0) {
    const chosen = categoriesForPortal(defaults, { id: tender.portalId, kind: tender.portalKind });
    const organisations = organisationsForPortal(defaults, { id: tender.portalId });
    const stillOut = !actual.some((name) => chosen.some((item) => sameText(item, name)));
    if (stillOut && !chosenOrganisationOf([tender.organisation], organisations)) {
      reasons.category = actual[0];
      reasons.organisation = tender.organisation?.split('||').map((part) => part.trim()).find(Boolean) ?? null;
    }
  }

  const titleText = [tender.title, tender.workDescription].filter(Boolean).join(' ');
  if (gate('G3')?.result === 'REJECT' && evaluateTenderIntent(titleText, tender.details, defaults.keywords).intent.result !== 'PASS') {
    reasons.noIntentWord = true;
    const text = [workPartOfTitle(tender.title), tender.workDescription].filter(Boolean).join(' . ');
    const ranked = workPhrasesIn(text);
    const good = ranked.filter((item) => item.score > 0);
    // Nothing marks it as IT work: the title's first phrase is still the best guess.
    reasons.phrases = (good.length > 0 ? good : ranked.slice(0, 1)).map((item) => item.phrase);
  }

  const exclusion = gate('G4');
  if (exclusion?.result === 'REJECT') {
    const evaluated = typeof exclusion.evidence.evaluatedText === 'string' && exclusion.evidence.evaluatedText.trim() ? exclusion.evidence.evaluatedText : tender.title;
    reasons.excludedWords = evaluateExcludedScope(evaluated, defaults.excludedKeywords).matchedTerms;
  }
  return reasons;
}

function missedSomething(reasons: MissReasons): boolean {
  return reasons.category !== null || reasons.noIntentWord || reasons.excludedWords.length > 0;
}

/** "its title", "both titles", "all 3 titles"; or titles and work descriptions when it was found there. */
function whereFound(count: number, onlyTitles: boolean): string {
  const what = onlyTitles ? 'title' : 'title or work description';
  if (count === 1) return `its ${what}`;
  return `${count === 2 ? 'both' : `all ${count}`} ${onlyTitles ? 'titles' : 'titles or work descriptions'}`;
}

/** Intent phrases that cover the missed tenders: each next phrase must cover a tender the earlier ones did not. */
function intentSuggestions(missed: Array<{ tender: MissedTender; reasons: MissReasons }>, excludedKeywords: readonly string[]): MissedSuggestion[] {
  const needing = missed.filter((item) => item.reasons.noIntentWord && item.reasons.phrases.length > 0);
  const holders = new Map<string, number[]>();
  const best = new Map<string, number>();
  needing.forEach((item, index) => {
    item.reasons.phrases.forEach((phrase, rank) => {
      holders.set(phrase, [...(holders.get(phrase) ?? []), index]);
      best.set(phrase, Math.min(best.get(phrase) ?? Infinity, rank));
    });
  });
  // Only a tender's own top phrases are offered, but every tender holding one counts for it.
  const offered = [...holders.keys()].filter((phrase) => (best.get(phrase) ?? Infinity) < PHRASES_PER_TENDER);
  offered.sort((a, b) => holders.get(b)!.length - holders.get(a)!.length || best.get(a)! - best.get(b)! || a.localeCompare(b));
  const covered = new Set<number>();
  const chosen: string[] = [];
  for (const phrase of offered) {
    if (chosen.length >= MAX_INTENT_SUGGESTIONS) break;
    if (holders.get(phrase)!.every((index) => covered.has(index))) continue;
    chosen.push(phrase);
    for (const index of holders.get(phrase)!) covered.add(index);
  }
  return chosen.map((phrase) => {
    const indexes = holders.get(phrase)!;
    const tenders = indexes.map((index) => needing[index].tender);
    const onlyTitles = tenders.every((tender) => ` ${matchKey(workPartOfTitle(tender.title))} `.includes(` ${matchKey(phrase)} `));
    const note = conflictNote(phrase, excludedKeywords);
    return {
      key: `intent:${phrase}`,
      fix: { kind: 'ADD_INTENT_WORD', phrase },
      label: `Add the intent word ${quoted(phrase)}`,
      reason: `Missed ${tendersCount(tenders.length)} you wanted: ${quoted(phrase)} was in ${whereFound(tenders.length, onlyTitles)}.`,
      ...(note ? { note } : {}),
      tenders: tenders.length,
      titles: tenders.slice(0, 3).map((tender) => tender.title),
    };
  });
}

function group<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return groups;
}

const KIND_ORDER: Record<MissedFix['kind'], number> = { ADD_CATEGORY: 0, ADD_ORGANISATION: 1, ADD_INTENT_WORD: 2, REVIEW_EXCLUDED_WORD: 3 };

/**
 * One list of fixes for the wanted tenders of the last 60 days that a rule
 * missed, the fix that would have kept the most of them first.
 */
export function explainMissedTenders(tenders: readonly MissedTender[], defaults: RunDefaults, options: { now?: Date } = {}): MissedTendersView {
  const since = (options.now ?? new Date()).getTime() - MISSED_WINDOW_DAYS * 86_400_000;
  const recent = tenders.filter((tender) => {
    const at = Date.parse(tender.approvedAt);
    return Number.isNaN(at) || at >= since;
  });
  const judged = recent.map((tender) => ({ tender, reasons: whyMissed(tender, defaults) }));
  const missed = judged.filter((item) => missedSomething(item.reasons));
  const suggestions: MissedSuggestion[] = [];
  const titlesOf = (items: typeof missed) => items.slice(0, 3).map((item) => item.tender.title);

  const byCategory = group(missed.filter((item) => item.reasons.category), (item) => `${item.tender.portalId}|${item.reasons.category!.toLocaleLowerCase()}`);
  for (const items of byCategory.values()) {
    const { tender, reasons } = items[0];
    const count = items.length;
    suggestions.push({
      key: `category:${tender.portalId}:${reasons.category!.toLocaleLowerCase()}`,
      fix: { kind: 'ADD_CATEGORY', portalId: tender.portalId, category: reasons.category! },
      label: `Add category ${quoted(reasons.category!)} for ${tender.portalName}`,
      reason: `Missed ${tendersCount(count)} you wanted: ${count === 1 ? 'it was' : 'they were'} in ${quoted(reasons.category!)}, which is not one of your categories.`,
      tenders: count,
      titles: titlesOf(items),
    });
  }

  const byOrganisation = group(missed.filter((item) => item.reasons.organisation), (item) => `${item.tender.portalId}|${item.reasons.organisation!.toLocaleLowerCase()}`);
  for (const items of byOrganisation.values()) {
    const { tender, reasons } = items[0];
    const count = items.length;
    suggestions.push({
      key: `organisation:${tender.portalId}:${reasons.organisation!.toLocaleLowerCase()}`,
      fix: { kind: 'ADD_ORGANISATION', portalId: tender.portalId, organisation: reasons.organisation! },
      label: `Add organisation ${quoted(reasons.organisation!)}`,
      reason: `Missed ${tendersCount(count)} you wanted from ${quoted(reasons.organisation!)} on ${tender.portalName}, outside your categories. Its tenders would be checked in any category.`,
      tenders: count,
      titles: titlesOf(items),
    });
  }

  suggestions.push(...intentSuggestions(missed, defaults.excludedKeywords));

  const byExcluded = group(missed.flatMap((item) => item.reasons.excludedWords.map((word) => ({ ...item, word }))), (item) => item.word.toLocaleLowerCase());
  for (const items of byExcluded.values()) {
    const word = items[0].word;
    const count = items.length;
    suggestions.push({
      key: `excluded:${word.toLocaleLowerCase()}`,
      fix: { kind: 'REVIEW_EXCLUDED_WORD', word },
      label: `Excluded word ${quoted(word)} rejected ${count === 1 ? 'a tender' : `${count} tenders`} you wanted; remove it, or keep it?`,
      reason: `It was in the title of ${items.slice(0, 2).map((item) => quoted(item.tender.title)).join(' and ')}${count > 2 ? ` and ${count - 2} more` : ''}.`,
      tenders: count,
      titles: items.slice(0, 3).map((item) => item.tender.title),
    });
  }

  suggestions.sort((a, b) => b.tenders - a.tenders || KIND_ORDER[a.fix.kind] - KIND_ORDER[b.fix.kind]);

  // The latest run that read tenders added by hand (newest choice first).
  const byHand = recent.filter((tender) => tender.addedByHand && tender.jobId)
    .sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
  const latestJob = byHand[0]?.jobId ?? null;
  const ofLatest = judged.filter((item) => item.tender.addedByHand && item.tender.jobId === latestJob);
  return {
    missed: missed.length,
    suggestions,
    latestRun: latestJob ? { jobId: latestJob, addedByHand: ofLatest.length, missed: ofLatest.filter((item) => missedSomething(item.reasons)).length } : null,
  };
}
