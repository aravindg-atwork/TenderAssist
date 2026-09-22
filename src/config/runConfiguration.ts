import { CONFIGURED_SEARCHES } from '../search/searchConfig.js';

export interface RunConfiguration {
  /** Native date-input format. */
  searchDate: string;
  productCategories: string[];
  keywords: string[];
  excludedKeywords: string[];
}

export interface RunDefaults {
  productCategories: string[];
  keywords: string[];
  excludedKeywords: string[];
}

export const DEFAULT_RUN_DEFAULTS: RunDefaults = {
  productCategories: CONFIGURED_SEARCHES.map((search) => search.productCategory),
  keywords: [
    'software development',
    'web application',
    'mobile application',
    'information technology services',
    'system integration',
    'digitization',
    'documentary film',
    'video production',
  ],
  excludedKeywords: [
    'annual maintenance contract',
    'AMC',
    'computer hardware',
    'laptop',
    'desktop computer',
    'printer',
    'repair and maintenance',
  ],
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

export function normalizeRunDefaults(input: RunDefaults): RunDefaults {
  const productCategories = normalizeList(input.productCategories, 'Product categories');
  const keywords = normalizeList(input.keywords, 'Intent keywords');
  const excludedKeywords = normalizeList(input.excludedKeywords, 'Excluded keywords');
  if (productCategories.length === 0) throw new Error('Choose at least one product category.');
  if (keywords.length === 0) throw new Error('Add at least one intent keyword.');
  return { productCategories, keywords, excludedKeywords };
}

export function normalizeRunConfiguration(input: RunConfiguration): RunConfiguration {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.searchDate)) {
    throw new Error('Search date must use YYYY-MM-DD format.');
  }
  const parsed = new Date(`${input.searchDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Search date is invalid.');
  return { searchDate: input.searchDate, ...normalizeRunDefaults(input) };
}
