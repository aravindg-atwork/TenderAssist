import { CONFIGURED_SEARCHES } from '../search/searchConfig.js';

export interface RunConfiguration {
  /** Native date-input format. */
  searchDate: string;
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
  /** GeM searches service bids; this adds product bids too. */
  gemIncludeProducts: boolean;
}

// GeM's starting categories, exactly as GeM's own Category dropdown shows
// them (GeM adds an example after " - "), for the office's kinds of work:
// application development, e-learning, software applications and AMC,
// websites and mobile apps. Custom bids are where buyers describe their own
// work, so the intent words decide those. GeM's "Annual Maintenance Service"
// entries are all hardware AMC, so they are left for the operator to add.
export const DEFAULT_GEM_CATEGORIES: readonly string[] = [
  'Custom Bid For Services',
  'Application Development',
  'Application Development And Maintenance Resource Hiring Services',
  'Hiring Of Professionals For Application Development And Maintenance - Data Science And Analytics Role; Data Analyst; 3 Years And Less Than 6 Years',
  'E-learning Content Development - Non-igot; Restructure & Rewrite Content, Storyboarding With Production Support; Hindi, English, Tamil, Kannada, Telugu, Bengali, Assamese; Mobile And Laptop/desktop Both; Textiles & Clothing; Type Of Content; Na; Refe..',
  'Interactive Content Creation Services',
  'Software Support Service',
  'Software Support Services 2.0 - Microsoft; Operating System Software; Maintenance Services; Not Applicable; General Service Provider',
  'Hiring Of Agency For It Projects- Milestone Basis',
  'Design, Development, Implementation, And Maintenance Of Websites, Web Portal, Web-enabled Application And Mobile Apps - Open Source Solution (oss)',
  'Web/mobile Based Ar/vr Or Ar/vr Related Application Development',
];

/**
 * Intent words in the way the office's own tenders are worded, taken from its
 * list of tenders it pursued in 2026-27 (341 titles): these recognise 304 of
 * them, against 134 for the earlier list. Single words count in a title only.
 */
export const RECOMMENDED_INTENT_WORDS: readonly string[] = [
  'application development', 'app development', 'software development', 'software application', 'web application',
  'web based', 'web portal', 'portal development', 'website development', 'website design', 'website redesign',
  'website maintenance', 'web hosting', 'mobile app', 'mobile application', 'android app', 'e-learning',
  'learning content', 'content development', 'interactive content', 'learning management system', 'learning system', 'e-content',
  'IT projects', 'IT project', 'management system', 'management software', 'management portal', 'information system',
  'HRMS', 'ERP', 'academic erp', 'chatbot', 'artificial intelligence', 'AI/ML', 'AI based', 'AI enabled', 'AI driven',
  'whatsapp', 'cloud based software', 'SaaS', 'digital platform', 'digital transformation', 'digital application',
  'application modules', 'document management system', 'automation software', 'examination software',
  'examination system', 'computer based test', 'computer based examination', 'online recruitment', 'recruitment portal',
  'online application', 'online registration', 'registration system', 'system implementation partner',
  'complaint management', 'grievance management', 'visitor management', 'GIS implementation', 'e-commerce platform',
  'full stack', 'software implementation', 'enterprise application', 'application service provider', 'online portal',
  'system integrator', 'AR/VR', 'virtual reality', 'software support', 'software maintenance', 'application maintenance',
  'software AMC', 'AMC of software', 'AMC of website', 'penetration testing', 'security audit of website',
  'database administration', 'edtech', 'digitization', 'digitisation', 'website', 'websites', 'portal', 'software',
  'app', 'apps', 'LMS', 'CMS', 'dashboard',
];

/**
 * Words too broad to mean the office's work on their own: "AMC" alone keeps
 * maintenance contracts for furnaces and RO plants.
 */
export const TOO_BROAD_INTENT_WORDS: readonly string[] = [
  'amc', 'maintenance', 'support', 'service', 'services', 'system', 'management', 'online', 'digital', 'it', 'development', 'design', 'data',
];

export const DEFAULT_RUN_DEFAULTS: RunDefaults = {
  productCategories: CONFIGURED_SEARCHES.map((search) => search.productCategory),
  keywords: [...RECOMMENDED_INTENT_WORDS],
  // AMC work is wanted (software AMC), so it is not excluded.
  excludedKeywords: [
    'computer hardware',
    'laptop',
    'desktop computer',
    'printer',
    'repair and maintenance',
  ],
  categoriesByPortal: {},
  gemIncludeProducts: false,
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
  return { ...normalizeLists(input), categoriesByPortal, gemIncludeProducts: input.gemIncludeProducts === true };
}

/** A website's chosen categories, or its starting ones when none are chosen yet. */
export function categoriesForPortal(defaults: RunDefaults, portal: { id: string; kind?: string }): string[] {
  const chosen = defaults.categoriesByPortal?.[portal.id];
  if (chosen && chosen.length > 0) return [...chosen];
  return portal.kind === 'GEM' ? [...DEFAULT_GEM_CATEGORIES] : [...defaults.productCategories];
}

export function normalizeRunConfiguration(input: RunConfiguration): RunConfiguration {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.searchDate)) {
    throw new Error('Search date must use YYYY-MM-DD format.');
  }
  const parsed = new Date(`${input.searchDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Search date is invalid.');
  const portalId = typeof input.portalId === 'string' && input.portalId.trim() ? input.portalId.trim() : 'tamil-nadu';
  return { searchDate: input.searchDate, portalId, ...normalizeLists(input) };
}
