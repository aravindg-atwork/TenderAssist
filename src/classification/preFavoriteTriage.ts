import { evaluateExcludedScope, evaluateIntentKeywords, type TextGateResult } from './intentGates.js';

export type PreFavoriteAction = 'FAVORITE' | 'REJECT' | 'REVIEW_DETAIL' | 'HOLD';
export type PreFavoriteConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PreFavoriteDecision {
  action: PreFavoriteAction;
  confidence: PreFavoriteConfidence;
  reasonCode: string;
  intent: TextGateResult;
  exclusion: TextGateResult;
}

export interface PreFavoriteIntent {
  keywords: string[];
  excludedKeywords: string[];
}

export function triageTenderTitle(
  title: string,
  config: PreFavoriteIntent
): PreFavoriteDecision {
  const intent = evaluateIntentKeywords(title, config.keywords);
  const exclusion = evaluateExcludedScope(title, config.excludedKeywords);

  if (exclusion.result === 'REJECT') {
    return { action: 'REJECT', confidence: 'HIGH', reasonCode: 'TITLE_EXCLUDED_SCOPE', intent, exclusion };
  }
  if (intent.result === 'PASS') {
    return { action: 'FAVORITE', confidence: 'HIGH', reasonCode: 'TITLE_INTENT_MATCH', intent, exclusion };
  }
  return { action: 'REVIEW_DETAIL', confidence: 'LOW', reasonCode: 'TITLE_NEEDS_DETAIL', intent, exclusion };
}

export function triageTenderDetail(
  title: string,
  detailText: string,
  primaryScopeText: string,
  config: PreFavoriteIntent
): PreFavoriteDecision {
  const intent = evaluateIntentKeywords(`${title} ${detailText}`, config.keywords);
  const exclusion = evaluateExcludedScope(primaryScopeText, config.excludedKeywords);

  if (exclusion.result === 'REJECT') {
    return { action: 'REJECT', confidence: 'HIGH', reasonCode: 'DETAIL_EXCLUDED_SCOPE', intent, exclusion };
  }
  if (intent.result === 'PASS') {
    return { action: 'FAVORITE', confidence: 'MEDIUM', reasonCode: 'DETAIL_INTENT_MATCH', intent, exclusion };
  }
  if (intent.result === 'REJECT') {
    return { action: 'REJECT', confidence: 'MEDIUM', reasonCode: 'DETAIL_NO_INTENT_MATCH', intent, exclusion };
  }
  return { action: 'HOLD', confidence: 'LOW', reasonCode: 'DETAIL_STILL_UNCERTAIN', intent, exclusion };
}
