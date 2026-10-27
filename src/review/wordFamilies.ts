import type { IntentFamily } from '../config/runConfiguration.js';
import { workPartOfTitle, type DecidedTenderText } from './wordSuggestions.js';
import { headWordOf, matchKey, workPhrasesIn } from './workPhrases.js';

// Word families: one name for the many ways buyers word the same work
// ("Websites": web portal, website development, e-governance portal). These
// are suggestions for the operator to add with one click; nothing is added
// to their words on its own.

export interface StarterFamily {
  name: string;
  phrases: readonly string[];
  /** Shown beside every phrase of the family. */
  note?: string;
}

const AMC_NOTE = 'AMC tenders are often for furnaces or RO plants too, and “AMC” or “maintenance” may be in your excluded words. Add only if you bid for software AMC.';

/**
 * How Indian government tenders usually word the office's six kinds of
 * work, as titles on Tamil Nadu and GeM put them.
 */
export const STARTER_FAMILIES: readonly StarterFamily[] = [
  { name: 'Websites', phrases: ['website development', 'website design', 'web portal', 'web application', 'website redesign', 'e-governance portal', 'dynamic website', 'website maintenance'] },
  { name: 'Mobile apps', phrases: ['mobile application', 'mobile app', 'android application', 'ios application', 'android app', 'mobile app development'] },
  { name: 'Application development', phrases: ['application development', 'web based application', 'application software', 'customised software', 'software development', 'online application'] },
  { name: 'Software applications', phrases: ['software application', 'software solution', 'erp software', 'management software', 'mis software', 'online portal'] },
  { name: 'E-learning', phrases: ['e-learning', 'learning management system', 'e-content development', 'e-learning content', 'online learning platform', 'digital learning content'] },
  { name: 'Software AMC', phrases: ['software maintenance', 'software support', 'amc of software', 'software amc', 'application maintenance', 'annual maintenance contract'], note: AMC_NOTE },
];

export interface FamilySuggestion {
  phrase: string;
  /** Plain reason, e.g. "in 3 tenders you approved". */
  reason: string;
  note?: string;
}

export interface StarterFamilyOffer {
  name: string;
  phrases: string[];
  /** The operator's own intent words that belong in it; moved there when it is added. */
  yours: string[];
  note?: string;
}

export interface FamilySuggestions {
  /** By family name, as the operator named it. */
  byFamily: Record<string, FamilySuggestion[]>;
  /** Starter families the operator has not made yet. */
  starters: StarterFamilyOffer[];
}

export interface FamilySuggestionInput {
  families: readonly IntentFamily[];
  keywords: readonly string[];
  excludedKeywords: readonly string[];
  approved: readonly DecidedTenderText[];
  /** Most suggestions per family. */
  limit?: number;
}

const tenders = (count: number) => `${count} ${count === 1 ? 'tender' : 'tenders'}`;

/** A note when the phrase would clash with the excluded words, or is AMC work. */
export function conflictNote(phrase: string, excludedKeywords: readonly string[]): string | undefined {
  const padded = ` ${matchKey(phrase)} `;
  const clash = excludedKeywords.find((word) => {
    const key = matchKey(word);
    return key !== '' && padded.includes(` ${key} `);
  });
  if (clash) return `Your excluded word “${clash}” rejects a tender with this in its title, so also remove “${clash}” if you want these.`;
  if (/ (amc|annual maintenance|maintenance contract) /.test(padded)) return AMC_NOTE;
  return undefined;
}

/** The starter family that a family of the operator's is, by name or by a shared phrase. */
function starterFor(family: IntentFamily): StarterFamily | undefined {
  const name = family.name.toLocaleLowerCase();
  const own = new Set(family.phrases.map(matchKey));
  return STARTER_FAMILIES.find((starter) => starter.name.toLocaleLowerCase() === name)
    ?? STARTER_FAMILIES.find((starter) => starter.phrases.some((phrase) => own.has(matchKey(phrase))));
}

/**
 * Words to add to each family: phrases from approved tenders that end on the
 * same work word as one of the family's ("portal", "application", "app",
 * "website"), or that stand in two or more approved titles beside one of
 * its phrases; then the family's usual wordings from the starter list.
 * Never a phrase that is already an intent word or contains one.
 */
export function suggestFamilyWords(input: FamilySuggestionInput): FamilySuggestions {
  const limit = input.limit ?? 8;
  const existing = input.keywords.map(matchKey).filter(Boolean);
  const isCovered = (phrase: string) => {
    const padded = ` ${matchKey(phrase)} `;
    return existing.some((word) => padded.includes(` ${word} `));
  };
  const approved = input.approved.map((tender) => {
    const text = [workPartOfTitle(tender.title), tender.description].filter(Boolean).join(' . ');
    return { key: ` ${matchKey(text)} `, phrases: workPhrasesIn(text).filter((item) => item.score > 0).map((item) => item.phrase) };
  });

  const byFamily: Record<string, FamilySuggestion[]> = {};
  for (const family of input.families) {
    const heads = new Set(family.phrases.map(headWordOf).filter(Boolean));
    const ownKeys = family.phrases.map(matchKey).filter(Boolean);
    const sameHead = new Map<string, number>();
    const together = new Map<string, { count: number; with: string }>();
    for (const tender of approved) {
      const beside = family.phrases.find((phrase) => tender.key.includes(` ${matchKey(phrase)} `));
      for (const phrase of tender.phrases) {
        if (isCovered(phrase)) continue;
        if (heads.has(headWordOf(phrase))) sameHead.set(phrase, (sameHead.get(phrase) ?? 0) + 1);
        else if (beside) together.set(phrase, { count: (together.get(phrase)?.count ?? 0) + 1, with: together.get(phrase)?.with ?? beside });
      }
    }
    const learnt: Array<FamilySuggestion & { count: number }> = [
      ...[...sameHead].map(([phrase, count]) => ({ phrase, count, reason: `in ${tenders(count)} you approved` })),
      ...[...together].filter(([, item]) => item.count >= 2)
        .map(([phrase, item]) => ({ phrase, count: item.count, reason: `beside “${item.with}” in ${tenders(item.count)} you approved` })),
    ].sort((a, b) => b.count - a.count || a.phrase.split(' ').length - b.phrase.split(' ').length || a.phrase.localeCompare(b.phrase));
    // A longer phrase holding a learnt one adds nothing ("web portal development" beside "web portal").
    const kept = learnt.filter((item) => !learnt.some((other) => other.phrase !== item.phrase && ` ${item.phrase} `.includes(` ${other.phrase} `)));
    const starter = starterFor(family);
    const usual: FamilySuggestion[] = (starter?.phrases ?? [])
      .filter((phrase) => !isCovered(phrase) && !ownKeys.includes(matchKey(phrase)))
      .map((phrase) => ({ phrase, reason: 'often used by government buyers' }));
    const seen = new Set<string>();
    byFamily[family.name] = [...kept.map(({ phrase, reason }) => ({ phrase, reason })), ...usual]
      .filter((item) => !seen.has(matchKey(item.phrase)) && Boolean(seen.add(matchKey(item.phrase))))
      .slice(0, limit)
      .map((item) => {
        const note = conflictNote(item.phrase, input.excludedKeywords) ?? starter?.note;
        return note ? { ...item, note } : item;
      });
  }

  const made = new Set(input.families.map((family) => family.name.toLocaleLowerCase()));
  const inAFamily = new Set(input.families.flatMap((family) => family.phrases.map(matchKey)));
  const starters = STARTER_FAMILIES
    .filter((starter) => !made.has(starter.name.toLocaleLowerCase()))
    .map((starter) => {
      const keys = new Set(starter.phrases.map(matchKey));
      const yours = input.keywords.filter((word) => keys.has(matchKey(word)) && !inAFamily.has(matchKey(word)));
      return { name: starter.name, phrases: [...starter.phrases], yours, ...(starter.note ? { note: starter.note } : {}) };
    });
  return { byFamily, starters };
}
