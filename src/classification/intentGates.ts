export interface TextGateResult {
  result: 'PASS' | 'REJECT' | 'UNCERTAIN';
  reasonCode: string;
  matchedTerms: string[];
}

function normalized(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchingTerms(text: string, terms: string[], wholePhrase = false): string[] {
  const haystack = ` ${normalized(text)} `;
  return terms.filter((term) => {
    const needle = normalized(term);
    if (!needle) return false;
    if (haystack.includes(` ${needle} `)) return true;
    if (wholePhrase) return false;
    const tokens = needle.split(' ');
    return tokens.length > 1 && tokens.every((token) => haystack.includes(` ${token} `));
  });
}

/** G3: the detail page must contain at least one explicit user intent term. */
export function evaluateIntentKeywords(
  detailText: string,
  keywords: string[],
  /**
   * Only the words together, in order. For long documents (GeM bid PDFs),
   * where "mobile" in a contact line and "application" in the general terms
   * would otherwise count as "mobile application".
   */
  options: { wholePhrase?: boolean } = {}
): TextGateResult {
  if (!detailText.trim()) {
    return { result: 'UNCERTAIN', reasonCode: 'DETAIL_TEXT_MISSING', matchedTerms: [] };
  }
  const matchedTerms = matchingTerms(detailText, keywords, options.wholePhrase);
  return matchedTerms.length > 0
    ? { result: 'PASS', reasonCode: 'INTENT_KEYWORD_MATCH', matchedTerms }
    : { result: 'REJECT', reasonCode: 'NO_INTENT_KEYWORD_MATCH', matchedTerms: [] };
}

/**
 * G4: exclusion terms are evaluated against the title and concise portal
 * metadata, not the entire tender body. Maintenance clauses are common in
 * otherwise relevant software tenders; searching the complete body would
 * incorrectly make those incidental clauses the tender's primary scope.
 */
export function evaluateExcludedScope(summaryText: string, excludedKeywords: string[]): TextGateResult {
  if (excludedKeywords.length === 0) {
    return { result: 'PASS', reasonCode: 'NO_EXCLUSION_TERMS_CONFIGURED', matchedTerms: [] };
  }
  const matchedTerms = matchingTerms(summaryText, excludedKeywords);
  return matchedTerms.length > 0
    ? { result: 'REJECT', reasonCode: 'EXCLUDED_PRIMARY_SCOPE', matchedTerms }
    : { result: 'PASS', reasonCode: 'NO_EXCLUDED_PRIMARY_SCOPE', matchedTerms: [] };
}

/**
 * A tender's intent words, the same way on every website. In the title, a
 * word or phrase counts when its words stand together. In the details (a
 * whole page or bid document, with menus and standard terms), only phrases of
 * two or more words count: single words such as "website", "portal" or "AMC"
 * appear on almost every page.
 */
export function evaluateTenderIntent(title: string, details: string, keywords: string[]): { title: TextGateResult; intent: TextGateResult } {
  const titleResult = evaluateIntentKeywords(title, keywords, { wholePhrase: true });
  const phrases = keywords.filter((keyword) => normalized(keyword).split(' ').filter(Boolean).length > 1);
  const detailResult = details.trim() ? evaluateIntentKeywords(details, phrases, { wholePhrase: true }) : { matchedTerms: [] as string[] };
  const matchedTerms = [...new Set([...titleResult.matchedTerms, ...detailResult.matchedTerms])];
  if (!title.trim() && !details.trim()) return { title: titleResult, intent: { result: 'UNCERTAIN', reasonCode: 'DETAIL_TEXT_MISSING', matchedTerms: [] } };
  return {
    title: titleResult,
    intent: matchedTerms.length > 0
      ? { result: 'PASS', reasonCode: 'INTENT_KEYWORD_MATCH', matchedTerms }
      : { result: 'REJECT', reasonCode: 'NO_INTENT_KEYWORD_MATCH', matchedTerms: [] },
  };
}
