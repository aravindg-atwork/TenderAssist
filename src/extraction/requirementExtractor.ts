import type { ExtractionConfidence } from '../persistence/repositories/tenderWorkflowRepository.js';
import { tenderPageFields } from '../review/portalPage.js';
import { criteriaSummary, findQualificationSections, gemEvaluationNote, type QualificationSection } from './qualificationSections.js';

export interface ExtractedRequirements {
  scope: string | null;
  eligibility: string | null;
  emd: string | null;
  tenderFee: string | null;
  submissionDeadline: string | null;
  submissionMethod: string | null;
  contact: string | null;
  /** How the bid is evaluated (GeM's QCBS note), when the documents say. */
  evaluation?: string | null;
  /** Which version of this reader made it (REQUIREMENTS_VERSION). */
  version?: number;
  /** The qualification sections found in the documents; present only when some were found. */
  sections?: QualificationSection[];
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
  // Only the block at the top: the documents below hold blank forms ("Name: ______") that are not the tender's.
  return tenderPageFields(text).filter((field) => !/^[_.\s-]+$/.test(field.value));
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


function joinedLines(...values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length > 0 ? present.join('\n') : null;
}

// An amount of money as tenders write it: "INR 50,000", "Rs. 1,180/-", "₹ 2.5 lakh".
const AMOUNT = String.raw`(?:(?:Rs\.?|INR|₹)\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:lakhs?|lacs?|crores?|cr)\b)?(?:\s*\/-)?`;
const NIL = String.raw`nil|exempted|not\s+applicable|not\s+required|waived`;
// A portal field that only points at the documents ("Please refer Tender documents").
const REFERS_ELSEWHERE = /^(?:please\s+)?(?:refer|see|as\s+per)\b.{0,60}(?:document|tender|nit|rfp|bid)/i;

/** A money value after one of the labels, only when one follows: never a word like "Detail". */
function amountAfter(text: string, labels: string): string | null {
  const money = new RegExp(String.raw`\b(?:${labels})\b[^\n\d₹]{0,40}?(${AMOUNT}|${NIL})`, 'i').exec(text);
  const value = money?.[1]?.trim().replace(/\s+/g, ' ');
  return value && (/\d/.test(value) ? /\d{3}|lakh|lac|crore|cr\b/i.test(value) : true) ? value : null;
}

/** The first email address and phone number in the text, as a contact. */
function contactIn(text: string): string | null {
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.exec(text)?.[0] ?? null;
  const phone = /(?:\+91[\s-]?)?(?:\b0\d{2,4}[\s-]?\d{6,8}\b|\b[6-9]\d{9}\b)/.exec(text)?.[0] ?? null;
  return joined(email, phone);
}

/** The first paragraph under a "Scope of Work" heading in the documents. */
function scopeIn(text: string): string | null {
  const heading = /(?:^|\n)\s*(?:\d+(?:\.\d+)*\.?\s+)?(?:scope\s+of\s+(?:the\s+)?(?:work|services?|supply)|description\s+of\s+work)\s*:?\s*\n([\s\S]{40,1400}?)(?:\n\s*\n|\n\s*(?:\d+(?:\.\d+)*\.?\s+)?[A-Z][A-Za-z ]{3,60}\n)/gi;
  for (const match of text.matchAll(heading)) {
    const paragraph = match[1].replace(/\[Page \d+\]/g, ' ').replace(/\s+/g, ' ').trim();
    // "The scope … is as set out in Volume II" points elsewhere; the next heading may hold the scope itself.
    if (/\b(?:as\s+set\s+out\s+in|refer(?:red)?\s+to|as\s+per\s+(?:the\s+)?(?:annex|volume|section))\b|\.{4,}/i.test(paragraph)) continue;
    return paragraph.slice(0, 1000);
  }
  return null;
}

/**
 * What the sheets need from a tender: the portal's own fields first, then
 * the documents. With `documents`, also the qualification sections a bidder
 * must read (pre-qualification, technical evaluation, documents to submit,
 * the buyer's terms on GeM), found by their headings.
 */
export function extractTenderRequirements(
  text: string,
  documents: ReadonlyArray<{ file_name: string; text_content?: string | null }> = [],
): RequirementExtractionResult {
  const fields = portalFields(text);
  const normalized = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  const sections = findQualificationSections(documents.map((document) => ({ name: document.file_name, text: document.text_content })));
  const gem = /^GEM\/\d{4}\//i.test(field(fields, /^bid\s*number$/i) ?? '');
  const title = field(fields, /^title$/i);
  const portalEligibility = field(fields, /^pre\s*-?\s*qualification/i);

  // Labels as TN Tenders (GePNIC) shows them on the tender details page, and as TenderAssist writes a GeM bid's facts.
  const workDescription = field(fields, /^work\s*description$/i);
  const fromPortal: ExtractedRequirements = {
    // GeM's "work description" is the bid's title again: the documents' scope comes first.
    scope: gem ? null : workDescription ?? title,
    // The website's summary and the criteria in the documents, both: neither alone is the whole.
    eligibility: joinedLines(portalEligibility && !REFERS_ELSEWHERE.test(portalEligibility) ? portalEligibility : null, criteriaSummary(sections)),
    emd: field(fields, /^emd\s*amount/i),
    tenderFee: field(fields, /^tender\s*fee/i),
    submissionDeadline: field(fields, /^bid\s*submission\s*end\s*date/i),
    submissionMethod: (() => {
      if (gem) return joined('Online on GeM', field(fields, /^bid\s*type$/i));
      const tenderType = field(fields, /^tender\s*type$/i);
      const contract = field(fields, /^form\s*of\s*contract$/i);
      return tenderType || contract ? joined('Online on the portal', tenderType && `tender type ${tenderType}`, contract && `contract ${contract}`) : null;
    })(),
    contact: joined(field(fields, /^(?:inviting\s*officer|tender\s*inviting\s*authority|name)$/i), field(fields, /^(?:inviting\s*officer\s*)?address$/i)),
  };

  // The page and documents, for anything the fields did not give; each only in the form it must have.
  const fromText: ExtractedRequirements = {
    // Below the website's field block, which already said what it has.
    // GeM's bid PDF names its attachments ("Scope of Work:1791201979.pdf"), so a GeM bid takes only a real scope section.
    scope: scopeIn(normalized) ?? (gem ? null : sentenceFor(fields.length > 0 ? normalized.replace(/^[\s\S]*?\n\s*\n/, '') : normalized, /\b(scope of work|description of work|work description|deliverables?)\b/i)),
    eligibility: portalEligibility ? null : sentenceFor(normalized, /\b(eligibility criteria|pre-qualification criteria|qualification criteria)\b/i),
    emd: amountAfter(normalized, String.raw`EMD(?:\s*amount)?|earnest\s+money(?:\s+deposit)?`),
    tenderFee: amountAfter(normalized, String.raw`tender\s+(?:document\s+)?fee|document\s+fee|cost\s+of\s+(?:tender|bid)\s+document|processing\s+fee`),
    submissionDeadline: valueFor(normalized, /\b(?:bid submission end date|submission deadline|last date (?:and time )?(?:for|of) (?:submission|receipt))\b\s*[:\-]?\s*(\d[^\n;]{5,60})/i),
    submissionMethod: sentenceFor(normalized, /\b(online submission|e-submission|submission method|submit(?:ted)? through)\b/i),
    contact: contactIn(normalized),
  };

  const requirements = Object.fromEntries(
    (Object.keys(fromPortal) as Array<keyof ExtractedRequirements>).map((key) => [key, fromPortal[key] ?? fromText[key]])
  ) as unknown as ExtractedRequirements;
  // The portal's pointer to the documents is kept only when the documents gave nothing better.
  if (!requirements.eligibility && portalEligibility) requirements.eligibility = portalEligibility;
  if (!requirements.scope && workDescription) requirements.scope = workDescription;
  const found = Object.values(requirements).filter(Boolean).length;
  const confidence: ExtractionConfidence = found >= 5 ? 'HIGH' : found >= 2 ? 'MEDIUM' : 'LOW';
  const versioned = { ...requirements, version: REQUIREMENTS_VERSION };
  if (sections.length === 0) return { requirements: versioned, confidence };
  return {
    requirements: { ...versioned, evaluation: gemEvaluationNote(normalized), sections },
    confidence,
  };
}

/** Raised when the reading of requirements improves, so sheets made from older readings are read again. */
export const REQUIREMENTS_VERSION = 3;

/** Whether a saved reading was made by an older version of this reader. */
export function isOutdatedReading(dataJson: string): boolean {
  try { return (JSON.parse(dataJson) as { version?: unknown }).version !== REQUIREMENTS_VERSION; } catch { return true; }
}
