import type { ClassificationGateRow } from '../persistence/repositories/classificationRepository.js';

// One plain sentence explaining why automation kept, rejected, or doubted a
// tender, built from the gate results stored on its SCREENED event.

export interface ScreenedGate {
  gate: 'G1' | 'G2' | 'G3' | 'G4';
  result: 'PASS' | 'REJECT' | 'UNCERTAIN' | 'NOT_RUN';
  reasonCode: string;
  evidence: Record<string, unknown>;
}

export interface TenderExplanation {
  sentence: string;
  /** Exclusion phrases that caused an automatic reject, shown so the operator can judge the rule. */
  matchedExclusions: string[];
  matchedIntent: string[];
}

const GATE_ORDER = ['G1', 'G2', 'G3', 'G4'] as const;

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

function quoted(values: string[]): string {
  return values.map((value) => `“${value}”`).join(', ');
}

/** Gate rows in the shape stored on a SCREENED event, so explanations survive run deletion. */
export function screeningEvidence(rows: ClassificationGateRow[]): { gates: ScreenedGate[] } {
  return {
    gates: rows.map((row) => {
      let evidence: Record<string, unknown> = {};
      try { evidence = JSON.parse(row.evidence_json) as Record<string, unknown>; } catch { /* keep empty */ }
      return { gate: row.gate, result: row.result, reasonCode: row.reason_code, evidence };
    }),
  };
}

export function parseScreenedGates(screeningDataJson: string | null | undefined): ScreenedGate[] {
  if (!screeningDataJson) return [];
  try {
    const parsed = JSON.parse(screeningDataJson) as { gates?: unknown };
    if (!Array.isArray(parsed.gates)) return [];
    return parsed.gates.filter((gate): gate is ScreenedGate =>
      typeof gate === 'object' && gate !== null && GATE_ORDER.includes((gate as ScreenedGate).gate)
    ).map((gate) => ({ ...gate, evidence: typeof gate.evidence === 'object' && gate.evidence ? gate.evidence : {} }));
  } catch {
    return [];
  }
}

// Short clause per failed check. Missing data is named as missing, never
// presented as a mismatch.
function rejectClause(gate: ScreenedGate): string {
  const evidence = gate.evidence;
  switch (gate.gate) {
    case 'G1':
      return gate.reasonCode === 'UNPARSEABLE_PUBLISHED_DATE' ? 'published date could not be read' : 'not published on the selected date';
    case 'G2': {
      const actual = list(evidence.actual);
      return actual.length ? `category ${quoted(actual)} is not in your list` : 'category was not captured';
    }
    case 'G3':
      return 'no intent phrase matched';
    case 'G4': {
      const excluded = list(evidence.matchedExcludedKeywords);
      return excluded.length ? `matched exclusion ${quoted(excluded)}` : 'primary scope is excluded';
    }
  }
}

function uncertainSentence(gate: ScreenedGate | undefined): string {
  if (!gate) return 'Not decided yet: not every check ran. The next search finishes them.';
  if (gate.reasonCode === 'NOT_IN_MY_TENDERS') {
    return 'Needs your judgement: it is no longer in your My Tenders on the portal (closed, withdrawn or removed), so TenderAssist did not read it. Decide it yourself.';
  }
  if (gate.reasonCode === 'GEM_BID_DOCUMENT_FAILED') {
    return 'Not decided yet: GeM did not send its bid document, even after several tries. Run its date again, or approve it and use Collect their documents.';
  }
  if (gate.reasonCode === 'DETAIL_REVIEW_FAILED' || gate.reasonCode === 'PREFAVORITE_DETAIL_REVIEW_FAILED' || gate.reasonCode === 'DETAIL_TEXT_MISSING') {
    return 'Not decided yet: its details page did not open, even on a second try. The next search opens it again from My Tenders.';
  }
  if (gate.reasonCode === 'INTENT_ONLY_IN_DETAILS') {
    const words = list(gate.evidence.matchedKeywords);
    return `Needs your judgement: ${words.length ? quoted(words) : 'an intent word'} appears only in its details, not its title, and nobody answered during the run.`;
  }
  if (gate.gate === 'G3') return 'Needs your judgement: the title hints at your intent, but its details page did not confirm it.';
  if (gate.gate === 'G4') return 'Needs your judgement: the work may include something you exclude.';
  return 'Needs your judgement.';
}

export function explainScreening(recommendation: 'KEEP' | 'REJECT' | 'UNCERTAIN' | null, gates: ScreenedGate[]): TenderExplanation {
  const byGate = (id: ScreenedGate['gate']) => gates.find((gate) => gate.gate === id);
  const matchedIntent = list(byGate('G3')?.evidence.matchedKeywords);
  const matchedExclusions = gates.flatMap((gate) => (gate.result === 'REJECT' || gate.result === 'UNCERTAIN') ? list(gate.evidence.matchedExcludedKeywords) : []);

  if (recommendation === null) {
    return { sentence: 'Not screened yet: the run stopped before its checks finished.', matchedExclusions, matchedIntent };
  }
  if (recommendation === 'REJECT') {
    const failed = GATE_ORDER.map(byGate).filter((gate): gate is ScreenedGate => gate?.result === 'REJECT');
    return {
      sentence: failed.length ? `Rejected: ${failed.map(rejectClause).join('; ')}.` : 'Rejected by an automatic check.',
      matchedExclusions,
      matchedIntent,
    };
  }
  if (recommendation === 'UNCERTAIN') {
    return { sentence: uncertainSentence(GATE_ORDER.map(byGate).find((gate) => gate?.result === 'UNCERTAIN')), matchedExclusions, matchedIntent };
  }
  const category = list(byGate('G2')?.evidence.matched);
  const parts = [
    category.length ? `category ${quoted(category)}` : null,
    matchedIntent.length ? `matched ${quoted(matchedIntent)}` : null,
  ].filter(Boolean);
  return { sentence: parts.length ? `Recommended: ${parts.join('; ')}.` : 'Recommended: passed every check.', matchedExclusions, matchedIntent };
}
