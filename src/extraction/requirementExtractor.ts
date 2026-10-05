import type { ExtractionConfidence } from '../persistence/repositories/tenderWorkflowRepository.js';

export interface ExtractedRequirements {
  scope: string | null;
  eligibility: string | null;
  emd: string | null;
  tenderFee: string | null;
  submissionDeadline: string | null;
  submissionMethod: string | null;
  contact: string | null;
}

export interface RequirementExtractionResult {
  requirements: ExtractedRequirements;
  confidence: ExtractionConfidence;
}

function sentenceFor(text: string, labels: RegExp): string | null {
  const parts = text.split(/(?<=[.!?])\s+|\s{2,}/).map((part) => part.trim()).filter(Boolean);
  return parts.find((part) => labels.test(part))?.slice(0, 1000) ?? null;
}

function valueFor(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim().replace(/\s+/g, ' ').slice(0, 500) ?? null;
}

/**
 * The portal's own fields, read from the "Label: value" lines TenderAssist
 * stores at the top of the tender text (one per field on the details page).
 */
function portalFields(text: string): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];
  for (const line of text.split('\n')) {
    const match = /^([^:\n]{2,80}):\s+(.+)$/.exec(line.trim());
    if (match) fields.push({ label: match[1].trim(), value: match[2].trim() });
  }
  return fields;
}

/** The first field whose label matches, skipping empty or "NA" values. */
function field(fields: Array<{ label: string; value: string }>, label: RegExp): string | null {
  const found = fields.find((candidate) => label.test(candidate.label) && !/^(?:na|n\/a|nil|-+)$/i.test(candidate.value));
  return found ? found.value.slice(0, 1000) : null;
}

function joined(...values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length > 0 ? present.join(', ') : null;
}

export function extractTenderRequirements(text: string): RequirementExtractionResult {
  const fields = portalFields(text);
  const normalized = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();

  // Labels as TN Tenders (GePNIC) shows them on the tender details page.
  const fromPortal: ExtractedRequirements = {
    scope: field(fields, /^work\s*description$/i) ?? field(fields, /^title$/i),
    eligibility: field(fields, /^pre\s*-?\s*qualification/i),
    emd: field(fields, /^emd\s*amount/i),
    tenderFee: field(fields, /^tender\s*fee/i),
    submissionDeadline: field(fields, /^bid\s*submission\s*end\s*date/i),
    submissionMethod: (() => {
      const tenderType = field(fields, /^tender\s*type$/i);
      const contract = field(fields, /^form\s*of\s*contract$/i);
      return tenderType || contract ? joined('Online on the portal', tenderType && `tender type ${tenderType}`, contract && `contract ${contract}`) : null;
    })(),
    contact: joined(field(fields, /^(?:inviting\s*officer|tender\s*inviting\s*authority|name)$/i), field(fields, /^(?:inviting\s*officer\s*)?address$/i)),
  };

  // Phrases in the page text, for anything the fields did not give.
  const fromText: ExtractedRequirements = {
    scope: sentenceFor(normalized, /\b(scope of work|description of work|work description|deliverables?)\b/i),
    eligibility: sentenceFor(normalized, /\b(eligibility|pre-qualification|qualification criteria)\b/i),
    emd: valueFor(normalized, /\b(?:EMD|earnest money deposit)\b\s*[:\-]?\s*([^\n.;]{1,160})/i),
    tenderFee: valueFor(normalized, /\b(?:tender fee|document fee|processing fee)\b\s*[:\-]?\s*([^\n.;]{1,160})/i),
    submissionDeadline: valueFor(normalized, /\b(?:bid submission end date|submission deadline|closing date)\b\s*[:\-]?\s*([^\n.;]{1,180})/i),
    submissionMethod: sentenceFor(normalized, /\b(online submission|e-submission|submission method|submit(?:ted)? through)\b/i),
    contact: valueFor(normalized, /\b(?:contact person|contact details?|email)\b\s*[:\-]?\s*([^\n]{1,240})/i),
  };

  const requirements = Object.fromEntries(
    (Object.keys(fromPortal) as Array<keyof ExtractedRequirements>).map((key) => [key, fromPortal[key] ?? fromText[key]])
  ) as unknown as ExtractedRequirements;
  const found = Object.values(requirements).filter(Boolean).length;
  const confidence: ExtractionConfidence = found >= 5 ? 'HIGH' : found >= 2 ? 'MEDIUM' : 'LOW';
  return { requirements, confidence };
}
