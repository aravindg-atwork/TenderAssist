export interface Gate1Result {
  gate: 'G1';
  result: 'PASS' | 'REJECT';
  reason_code: 'WITHIN_FRESHNESS_WINDOW' | 'OUTSIDE_FRESHNESS_WINDOW' | 'UNPARSEABLE_PUBLISHED_DATE';
  published_date: string | null;
  evaluated_against: string;
}

export function evaluateGate1(
  publishedDateIso: string | null,
  evaluatedAgainstIso: string,
  freshnessWindowDays: number
): Gate1Result {
  if (!publishedDateIso) {
    return {
      gate: 'G1',
      result: 'REJECT',
      reason_code: 'UNPARSEABLE_PUBLISHED_DATE',
      published_date: null,
      evaluated_against: evaluatedAgainstIso,
    };
  }

  const publishedMs = Date.parse(publishedDateIso);
  const evaluatedMs = Date.parse(evaluatedAgainstIso);
  const windowMs = freshnessWindowDays * 24 * 60 * 60 * 1000;
  const withinWindow = evaluatedMs >= publishedMs && evaluatedMs - publishedMs <= windowMs;

  return {
    gate: 'G1',
    result: withinWindow ? 'PASS' : 'REJECT',
    reason_code: withinWindow ? 'WITHIN_FRESHNESS_WINDOW' : 'OUTSIDE_FRESHNESS_WINDOW',
    published_date: publishedDateIso,
    evaluated_against: evaluatedAgainstIso,
  };
}
