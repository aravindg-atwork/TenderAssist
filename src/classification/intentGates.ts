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

function matchingTerms(text: string, terms: string[]): string[] {
  const haystack = ` ${normalized(text)} `;
  return terms.filter((term) => {
    const needle = normalized(term);
    return needle.length > 0 && haystack.includes(` ${needle} `);
  });
}

/** G3: the detail page must contain at least one explicit user intent term. */
export function evaluateIntentKeywords(detailText: string, keywords: string[]): TextGateResult {
  if (!detailText.trim()) {
    return { result: 'UNCERTAIN', reasonCode: 'DETAIL_TEXT_MISSING', matchedTerms: [] };
  }
  const matchedTerms = matchingTerms(detailText, keywords);
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
