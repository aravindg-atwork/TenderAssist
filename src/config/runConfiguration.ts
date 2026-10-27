/**
 * What a run's date means: the day tenders were published (a GeM bid's
 * start), or, on GeM only, the day bids close (CLOSING, runs before
 * 13 Oct 2026), or every open bid closing on `closingFrom` or later
 * (CLOSING_AFTER: "Bids with time to prepare").
 */
export type RunDateMeaning = 'PUBLISHED' | 'CLOSING' | 'CLOSING_AFTER';

export interface RunConfiguration {
  /** Native date-input format. */
  searchDate: string;
  /** Published unless given; runs saved before closing-date searches are all published. */
  dateMeaning?: RunDateMeaning;
  /** CLOSING_AFTER only: the earliest closing day kept (native date format). */
  closingFrom?: string;
  /**
   * PUBLISHED only: read just the tenders published at or after this Indian
   * time of the day (HH:MM), and none an earlier search of the day already
   * saw. Unset is the whole day.
   */
  fromTime?: string;
  /**
   * Organisations searched as well as the categories (Settings, per
   * website): their tenders in any category are read, and the intent and
   * excluded words decide them as for the categories.
   */
  organisations?: string[];
  /** Defaults to Tamil Nadu for jobs created before multi-portal support. */
  portalId?: string;
  productCategories: string[];
  keywords: string[];
  excludedKeywords: string[];
}

export interface RunDefaults {
  /** The starting categories for a GePNIC website with no choice of its own yet. */
  productCategories: string[];
  keywords: string[];
  excludedKeywords: string[];
  /**
   * Each website's own chosen categories, by website id, named exactly as
   * that website's category dropdown names them. A website missing here
   * uses its starting categories.
   */
  categoriesByPortal: Record<string, string[]>;
  /**
   * Each website's organisations to search, by website id, named as that
   * website names them (Tamil Nadu: its "Tenders by Organisation" list;
   * GeM: a ministry or department). None by default.
   */
  organisationsByPortal?: Record<string, string[]>;
  /** GeM searches service bids; this adds product bids too. */
  gemIncludeProducts: boolean;
  /**
   * GeM search words: every open bid with one in its title, category or
   * items is read, whatever its day or category (src/gem/gemWordSearch.ts).
   */
  gemSearchWords?: string[];
}

/** The most GeM search words: each one costs a few requests to GeM on every run. */
export const MAX_GEM_SEARCH_WORDS = 25;

// Every office bids for different work, so a new install starts with a few
// examples of each list, for the operator to replace with their own (the
// setup checklist ticks a list once it is theirs). Offices set up before
// 13 Oct 2026 keep their lists (migration 019 saved their GeM categories).

// GeM's starting categories, exactly as GeM's own Category dropdown shows
// them (GeM adds an example after " - "). Custom bids are where buyers
// describe their own work, so the intent words decide those.
export const DEFAULT_GEM_CATEGORIES: readonly string[] = [
  'Custom Bid For Services',
  'Application Development',
  'Design, Development, Implementation, And Maintenance Of Websites, Web Portal, Web-enabled Application And Mobile Apps - Open Source Solution (oss)',
];

/** Tamil Nadu's (and other GePNIC websites') starting categories. */
export const STARTING_PORTAL_CATEGORIES: readonly string[] = ['Computer- S/W', 'Information Technology', 'Info. Tech. Services'];

/** Starting intent words: examples of phrases from a tender title. */
export const STARTING_INTENT_WORDS: readonly string[] = ['software development', 'website development', 'mobile application'];

/** Starting excluded words: examples of work that is not for the office. */
export const STARTING_EXCLUDED_WORDS: readonly string[] = ['laptop', 'printer'];

/**
 * Words too broad to mean the office's work on their own: "AMC" alone keeps
 * maintenance contracts for furnaces and RO plants.
 */
export const TOO_BROAD_INTENT_WORDS: readonly string[] = [
  'amc', 'maintenance', 'support', 'service', 'services', 'system', 'management', 'online', 'digital', 'it', 'development', 'design', 'data',
];

export const DEFAULT_RUN_DEFAULTS: RunDefaults = {
  productCategories: [...STARTING_PORTAL_CATEGORIES],
  keywords: [...STARTING_INTENT_WORDS],
  excludedKeywords: [...STARTING_EXCLUDED_WORDS],
  categoriesByPortal: {},
  organisationsByPortal: {},
  gemIncludeProducts: false,
  gemSearchWords: [],
};

function normalizeList(values: string[], label: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be a list.`);
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') throw new Error(`${label} must contain only text values.`);
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

function normalizeLists(input: Pick<RunDefaults, 'productCategories' | 'keywords' | 'excludedKeywords'>) {
  const productCategories = normalizeList(input.productCategories, 'Product categories');
  const keywords = normalizeList(input.keywords, 'Intent keywords');
  const excludedKeywords = normalizeList(input.excludedKeywords, 'Excluded keywords');
  if (productCategories.length === 0) throw new Error('Choose at least one product category.');
  if (keywords.length === 0) throw new Error('Add at least one intent keyword.');
  return { productCategories, keywords, excludedKeywords };
}

export function normalizeRunDefaults(input: RunDefaults): RunDefaults {
  const categoriesByPortal: Record<string, string[]> = {};
  // Settings saved before each website had its own list have none yet.
  const saved = input.categoriesByPortal && typeof input.categoriesByPortal === 'object' ? input.categoriesByPortal : {};
  for (const [portalId, values] of Object.entries(saved)) {
    const categories = normalizeList(values, 'Categories');
    if (categories.length === 0) throw new Error('Choose at least one category for each website.');
    categoriesByPortal[portalId] = categories;
  }
  const gemSearchWords = normalizeList(Array.isArray(input.gemSearchWords) ? input.gemSearchWords : [], 'Search words')
    .filter((word) => /[\p{L}\p{N}]{2}/u.test(word));
  if (gemSearchWords.length > MAX_GEM_SEARCH_WORDS) throw new Error(`Keep to ${MAX_GEM_SEARCH_WORDS} search words or fewer.`);
  const organisationsByPortal: Record<string, string[]> = {};
  const savedOrganisations = input.organisationsByPortal && typeof input.organisationsByPortal === 'object' ? input.organisationsByPortal : {};
  for (const [portalId, values] of Object.entries(savedOrganisations)) {
    const organisations = normalizeList(values, 'Organisations');
    if (organisations.length > MAX_ORGANISATIONS) throw new Error(`Keep to ${MAX_ORGANISATIONS} organisations or fewer for each website.`);
    if (organisations.length > 0) organisationsByPortal[portalId] = organisations;
  }
  return { ...normalizeLists(input), categoriesByPortal, organisationsByPortal, gemIncludeProducts: input.gemIncludeProducts === true, gemSearchWords };
}

/** The most organisations per website: each is one more search on Tamil Nadu. */
export const MAX_ORGANISATIONS = 30;

/** A website's chosen organisations, none until the operator picks some. */
export function organisationsForPortal(defaults: RunDefaults, portal: { id: string }): string[] {
  return [...(defaults.organisationsByPortal?.[portal.id] ?? [])];
}

const organisationKey = (value: string) => value.toLocaleLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The chosen organisation a tender comes from, by the organisation names it
 * gives (Tamil Nadu's "A||B" chain, GeM's ministry and department), or null.
 * A name matches the whole of one part, or the start of it, ignoring case
 * and punctuation: "Ministry of Railways" matches "Ministry of Railways"
 * and "Ministry of Railways - Zonal" but never a part with it in the middle.
 */
export function chosenOrganisationOf(names: ReadonlyArray<string | null | undefined>, chosen: readonly string[] | undefined): string | null {
  if (!chosen || chosen.length === 0) return null;
  const parts = names.flatMap((name) => (name ?? '').split('||')).map(organisationKey).filter(Boolean);
  for (const organisation of chosen) {
    const key = organisationKey(organisation);
    if (key && parts.some((part) => part === key || part.startsWith(`${key} `))) return organisation;
  }
  return null;
}

/** A website's chosen categories, or its starting ones when none are chosen yet. */
export function categoriesForPortal(defaults: RunDefaults, portal: { id: string; kind?: string }): string[] {
  const chosen = defaults.categoriesByPortal?.[portal.id];
  if (chosen && chosen.length > 0) return [...chosen];
  return portal.kind === 'GEM' ? [...DEFAULT_GEM_CATEGORIES] : [...defaults.productCategories];
}

/** "HH:MM" (24-hour) or undefined; "00:00" is the whole day. */
export function normalizeFromTime(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('The time to search from must be like 10:30.');
  const time = `${match[1].padStart(2, '0')}:${match[2]}`;
  return time === '00:00' ? undefined : time;
}

/**
 * Whether a tender published at this time (an ISO date-time in Indian time,
 * as the websites give it) is before the search's "from" time. Unknown
 * times are never left out.
 */
export function publishedBeforeFromTime(publishedIst: string | null | undefined, fromTime: string | undefined): boolean {
  if (!fromTime || !publishedIst) return false;
  const time = /T(\d{2}:\d{2})/.exec(publishedIst)?.[1];
  return time !== undefined && time < fromTime;
}

export function normalizeRunConfiguration(input: RunConfiguration): RunConfiguration {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.searchDate)) {
    throw new Error('Search date must use YYYY-MM-DD format.');
  }
  const parsed = new Date(`${input.searchDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Search date is invalid.');
  const portalId = typeof input.portalId === 'string' && input.portalId.trim() ? input.portalId.trim() : 'tamil-nadu';
  const dateMeaning: RunDateMeaning = input.dateMeaning === 'CLOSING' || input.dateMeaning === 'CLOSING_AFTER' ? input.dateMeaning : 'PUBLISHED';
  const organisations = normalizeList(Array.isArray(input.organisations) ? input.organisations : [], 'Organisations');
  const withOrganisations = organisations.length > 0 ? { organisations } : {};
  if (dateMeaning !== 'CLOSING_AFTER') {
    const fromTime = dateMeaning === 'PUBLISHED' ? normalizeFromTime(input.fromTime) : undefined;
    return { searchDate: input.searchDate, dateMeaning, portalId, ...(fromTime ? { fromTime } : {}), ...withOrganisations, ...normalizeLists(input) };
  }
  const closingFrom = typeof input.closingFrom === 'string' ? input.closingFrom : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closingFrom) || Number.isNaN(new Date(`${closingFrom}T00:00:00`).getTime())) throw new Error('Choose the earliest closing date.');
  return { searchDate: input.searchDate, dateMeaning, closingFrom, portalId, ...withOrganisations, ...normalizeLists(input) };
}
