import { TOO_BROAD_INTENT_WORDS } from '../config/runConfiguration.js';

// The short phrases in a tender title that could name the office's work:
// "web portal" in "Design, Development and Maintenance of Web Portal for
// TNSDC". Used to propose intent words; nothing here decides a tender.

export interface WorkPhrase {
  /** Lower case, as the title words stand ("e-learning", "android mobile application"). */
  phrase: string;
  /** Higher is a better intent word; 0 means nothing marks it as IT work. */
  score: number;
}

// Words that end a phrase: joining words, tender boilerplate, and the words
// buyers' names are made of ("for Greater Chennai Corporation").
const BREAKS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or',
  'the', 'to', 'with', 'within', 'under', 'via', 'per', 'all', 'other', 'etc', 'no', 'not', 'this', 'that', 'year', 'years',
  'tender', 'tenders', 'supply', 'work', 'works', 'providing', 'provision', 'procurement', 'purchase', 'hiring', 'hire',
  'selection', 'engagement', 'empanelment', 'agency', 'agencies', 'firm', 'firms', 'vendor', 'vendors', 'bid', 'bids', 'rfp',
  'eoi', 'rfq', 'request', 'proposal', 'proposals', 'quotation', 'quotations', 'invitation', 'inviting', 'invited', 'name',
  'various', 'item', 'items', 'nos', 'lot', 'contract', 'period', 'basis', 'regarding', 'reg', 'ref',
  'custom', 'yes', 'buyer', 'seller', 'premises', 'provider', 'onsite', 'offsite', 'quantity', 'qty',
  'department', 'dept', 'district', 'office', 'government', 'govt', 'tamil', 'nadu', 'chennai', 'state', 'india', 'national',
  'corporation', 'limited', 'ltd', 'board', 'university', 'college', 'municipality', 'panchayat', 'council', 'directorate',
  'commissionerate', 'authority', 'society', 'mission', 'ministry', 'collectorate', 'greater',
]);

// Words that name a kind of work but not the office's on their own.
const GENERIC = new Set([
  ...TOO_BROAD_INTENT_WORDS,
  'implementation', 'operation', 'operations', 'comprehensive', 'annual', 'new', 'existing', 'proposed', 'upgradation', 'upgrade',
  'enhancement', 'creation', 'setting', 'establishment', 'installation', 'commissioning', 'testing', 'integration', 'configuration',
  'customization', 'customisation', 'deployment', 'hosting', 'redesign', 'revamp', 'revamping', 'solution', 'solutions', 'project',
  'phase', 'module', 'modules', 'based', 'enabled', 'web-enabled', 'web-based', 'and',
]);

// The last word of a phrase that names the work itself.
const HEAD_WORDS = new Set([
  'portal', 'portals', 'website', 'websites', 'webportal', 'application', 'applications', 'app', 'apps', 'software', 'platform',
  'lms', 'erp', 'crm', 'e-learning', 'elearning', 'learning', 'e-content', 'e-governance', 'dashboard', 'mis', 'courseware',
]);

// Words that mark IT work anywhere in a phrase.
const IT_WORDS = new Set([
  ...HEAD_WORDS, 'web', 'mobile', 'android', 'ios', 'online', 'digital', 'computer', 'ict', 'cloud', 'governance', 'gis',
  'database', 'e-office', 'e-services', 'content', 'multimedia', 'e',
]);

const MIN_WORDS = 2;
const MAX_WORDS = 4;

/** Runs of title words between punctuation, numbers and break words. */
function segments(text: string): string[][] {
  const runs: string[][] = [];
  // Hyphens join words ("e-learning", "web-enabled"); a spaced dash or other punctuation ends a run.
  for (const part of text.normalize('NFKC').toLocaleLowerCase().split(/[,;:.()[\]/|&'"!?]+|\s-\s|\s+-|-\s+/)) {
    let run: string[] = [];
    for (const raw of part.split(/[^a-z0-9-]+/)) {
      const token = raw.replace(/^-+|-+$/g, '');
      if (!token || BREAKS.has(token) || /^\d+$/.test(token)) {
        if (run.length) runs.push(run);
        run = [];
        continue;
      }
      run.push(token);
    }
    if (run.length) runs.push(run);
  }
  return runs;
}

function scoreOf(tokens: string[]): number {
  if (tokens.every((token) => GENERIC.has(token) || token.length < 2)) return -1;
  const last = tokens[tokens.length - 1];
  let score = 0;
  if (HEAD_WORDS.has(last)) score += 3;
  if (tokens.some((token) => IT_WORDS.has(token))) score += 1;
  // A shorter phrase finds more of the same work.
  score -= (tokens.length - MIN_WORDS) * 0.5;
  // A phrase starting or ending on a generic word ("portal development") says less than the phrase inside it.
  if (GENERIC.has(tokens[0]) || GENERIC.has(last)) score -= 1;
  return score;
}

/**
 * Every 2–4 word phrase in the text that could be an intent word, best
 * first: phrases ending on a work word ("portal", "application",
 * "e-learning") and shorter ones lead. Phrases of only broad words
 * ("design development", "annual maintenance") are left out.
 */
export function workPhrasesIn(text: string): WorkPhrase[] {
  const found = new Map<string, number>();
  for (const run of segments(text)) {
    for (let start = 0; start < run.length; start += 1) {
      for (let length = MIN_WORDS; length <= MAX_WORDS && start + length <= run.length; length += 1) {
        const tokens = run.slice(start, start + length);
        const score = scoreOf(tokens);
        if (score < 0) continue;
        const phrase = tokens.join(' ');
        found.set(phrase, Math.max(found.get(phrase) ?? -Infinity, score));
      }
    }
  }
  return [...found.entries()]
    .map(([phrase, score]) => ({ phrase, score }))
    .sort((a, b) => b.score - a.score || a.phrase.split(' ').length - b.phrase.split(' ').length || a.phrase.localeCompare(b.phrase));
}

/** A phrase's words as the intent gates compare them ("e-learning" is "e learning"). */
export function matchKey(phrase: string): string {
  return phrase.normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The phrase's last word, for "shares its head word" (web portal → portal). */
export function headWordOf(phrase: string): string {
  return matchKey(phrase).split(' ').at(-1) ?? '';
}
