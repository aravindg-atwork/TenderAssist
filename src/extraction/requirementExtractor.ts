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

export function extractTenderRequirements(text: string): RequirementExtractionResult {
  const normalized = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  const requirements: ExtractedRequirements = {
    scope: sentenceFor(normalized, /\b(scope of work|description of work|work description|deliverables?)\b/i),
    eligibility: sentenceFor(normalized, /\b(eligibility|pre-qualification|qualification criteria)\b/i),
    emd: valueFor(normalized, /\b(?:EMD|earnest money deposit)\b\s*[:\-]?\s*([^\n.;]{1,160})/i),
    tenderFee: valueFor(normalized, /\b(?:tender fee|document fee|processing fee)\b\s*[:\-]?\s*([^\n.;]{1,160})/i),
    submissionDeadline: valueFor(normalized, /\b(?:bid submission end date|submission deadline|closing date)\b\s*[:\-]?\s*([^\n.;]{1,180})/i),
    submissionMethod: sentenceFor(normalized, /\b(online submission|e-submission|submission method|submit(?:ted)? through)\b/i),
    contact: valueFor(normalized, /\b(?:contact person|contact details?|email)\b\s*[:\-]?\s*([^\n]{1,240})/i),
  };
  const found = Object.values(requirements).filter(Boolean).length;
  const confidence: ExtractionConfidence = found >= 5 ? 'HIGH' : found >= 2 ? 'MEDIUM' : 'LOW';
  return { requirements, confidence };
}
