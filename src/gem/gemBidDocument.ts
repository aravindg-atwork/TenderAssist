// Reads a GeM bid PDF: its text, the facts the eligibility sheet needs, and
// the buyer's attachments it links to. The PDF is in Hindi and English; the
// facts are read from the English labels.

import { isGemFileUrl } from './gemClient.js';

export interface PdfContent {
  text: string;
  links: string[];
}

export interface GemDocumentFacts {
  bidEndsAt: string | null;
  bidOpensAt: string | null;
  offerValidity: string | null;
  ministry: string | null;
  department: string | null;
  organisation: string | null;
  office: string | null;
  itemCategory: string | null;
  contractPeriod: string | null;
  minimumTurnover: string | null;
  pastExperience: string | null;
  mseRelaxation: string | null;
  startupRelaxation: string | null;
  documentsRequired: string | null;
  bidToRa: string | null;
  bidType: string | null;
  estimatedValue: string | null;
  emdAmount: string | null;
  epbgPercentage: string | null;
  evaluationMethod: string | null;
  totalQuantity: string | null;
}

export interface GemAttachment {
  url: string;
  fileName: string;
}

/** Text and links of a PDF, page by page. */
export async function readPdf(data: Uint8Array): Promise<PdfContent> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data, useSystemFonts: false, verbosity: 0 });
  try {
    const document = await task.promise;
    let text = '';
    const links: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      text += '\n';
      for (const annotation of await page.getAnnotations()) {
        if (typeof annotation.url === 'string') links.push(annotation.url);
      }
    }
    return { text, links };
  } finally {
    await task.destroy();
  }
}

/** The PDF text without the Hindi, on one line, for reading the English labels. */
function englishLine(text: string): string {
  return text.replace(/[^\x20-\x7E₹\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The value after an English label, up to the next Hindi text or a long stop. */
function after(text: string, label: RegExp, value: RegExp = /([^\x00-\x1F\u007F-￿*]{1,300})/): string | null {
  const match = new RegExp(`${label.source}\\s*:?\\s*${value.source}`, 'i').exec(text);
  // Hindi glyphs leave stray punctuation behind a value ("No '").
  const found = match?.[1]?.replace(/\s+/g, ' ').trim().replace(/[^A-Za-z0-9)%.]+$/, '').replace(/\.$/, '');
  return found && !/^(?:na|n\/a|nil|-+)$/i.test(found) ? found : null;
}

/** "Yes", "No", or "Yes | Partial | Turn over value - 12 (in lakhs)". */
const YES_NO_DETAIL = /((?:Yes|No)\b[^;\x00-\x1F\u007F-￿/]{0,100})/;
const RELAXATION_FOR = /(?:Relaxation|Exemption) for (?:Years of Experience and Turnover|Turnover|Years of Experience)/;

const DATE_TIME = /(\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2})/;

export function factsFromBidText(text: string): GemDocumentFacts {
  // Line breaks inside a label or value carry no meaning in this PDF.
  const flat = text.replace(/\s+/g, ' ');
  return {
    bidEndsAt: after(flat, /Bid End Date\/Time/, DATE_TIME),
    bidOpensAt: after(flat, /Bid Opening Date\/Time/, DATE_TIME),
    offerValidity: after(flat, /Bid Offer Validity \(From End Date\)/, /(\d+ \(Days\))/),
    ministry: after(flat, /\/Ministry\/State Name/),
    department: after(flat, /\/Department Name/),
    organisation: after(flat, /\/Organisation Name/),
    office: after(flat, /\/Office Name/),
    itemCategory: after(flat, /\/Item Category/),
    contractPeriod: after(flat, /\/Contract Period/, /([\d.]+ \w+(?:\s?\(s\))?(?: \d+ \w+(?:\s?\(s\))?)?)/),
    minimumTurnover: after(flat, /Minimum Average Annual Turnover of the bidder(?: \(For \d+ Years\))?/, /([\d.,]+ (?:Lakh|Crore|Cr)\s?\(?s?\)?|[\d.,]+)/),
    pastExperience: after(flat, /Years of Past Experience Required for same\/similar (?:service|product)/, /(\d+ Year\s?\(?s?\)?)/),
    mseRelaxation: after(flat, new RegExp(`MSE ${RELAXATION_FOR.source}`), YES_NO_DETAIL),
    startupRelaxation: after(flat, new RegExp(`Startup ${RELAXATION_FOR.source}`), YES_NO_DETAIL),
    documentsRequired: after(flat, /\/Document required from seller/),
    bidToRa: after(flat, /\/Bid to RA enabled/, /(Yes|No)/),
    bidType: after(flat, /\/Type of Bid/, /(Single Packet Bid|Two Packet Bid)/),
    estimatedValue: after(flat, /Estimated Bid Value in INR \(Inclusive of all taxes\)/, /([\d,]+(?:\.\d+)?)/),
    emdAmount: after(flat, /\/EMD Amount/, /([\d,]+(?:\.\d+)?)/),
    epbgPercentage: after(flat, /ePBG Percentage\(%\)/, /([\d.]+)/),
    evaluationMethod: after(flat, /\/Evaluation Method/, /([A-Za-z ]{3,80}?)(?= [^\x20-\x7E]|$| \S*\/)/),
    totalQuantity: after(flat, /\/Total Quantity/, /([\d,]+)/),
  };
}

/** Rupees in the Indian way of writing them, without the sign (the screens add it): 10625689.63 → 1,06,25,689.63. */
export function rupees(raw: string | null): string | null {
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) return raw;
  return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/**
 * The part of the bid text that is about this bid. The generic GeM terms at
 * the end ("Disclaimer" onward) mention many kinds of work and would match
 * intent words on every bid.
 */
export function bidSpecificText(text: string): string {
  const english = englishLine(text);
  const disclaimer = english.search(/\/\s*Disclaimer\b/i);
  return disclaimer > 0 ? english.slice(0, disclaimer) : english;
}

/** The bid text without the Hindi, kept line by line for reading on screen. */
export function readableBidText(text: string): string {
  return text.split('\n').map((line) => line.replace(/[^\x20-\x7E₹]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => /[A-Za-z0-9]/.test(line)).join('\n');
}

function extensionOf(path: string): string {
  return /\.([a-z0-9]{2,5})$/i.exec(path)?.[1]?.toLowerCase() ?? 'pdf';
}

function cleanName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/**
 * The buyer's attachments a bid PDF links to, named the way the PDF names
 * them ("Scope of work:1789541628.pdf" → "Scope of work.pdf"). General GeM
 * terms and pages that are not files are left out.
 */
export function attachmentsFromBid(content: PdfContent): GemAttachment[] {
  const flat = englishLine(content.text);
  const labels = new Map<string, string>();
  for (const match of flat.matchAll(/([A-Za-z][A-Za-z0-9 ,&()'.-]{1,240}?)\s*[:-]\s*(\d{6,}\.[a-z0-9]{2,5})\b/gi)) {
    // Long labels are instructions ("Undertaking … is mandatory. Please download …"); keep the first sentence.
    const label = match[1].replace(/^.*\b(?:Data Required|Required :|Required)\s+/i, '').split(/\.\s/)[0].trim();
    if (label && !labels.has(match[2])) labels.set(match[2], label);
  }
  const seen = new Set<string>();
  const usedNames = new Set<string>();
  const attachments: GemAttachment[] = [];
  for (const url of content.links) {
    if (seen.has(url) || !isGemFileUrl(url)) continue;
    seen.add(url);
    const parsed = new URL(url);
    let fileName: string;
    if (parsed.hostname === 'fulfilment.gem.gov.in') {
      const path = parsed.searchParams.get('fileDownloadPath') ?? '';
      if (!path) continue;
      fileName = `Service level agreement.${extensionOf(path)}`;
    } else if (/\/resources\/upload_nas\//i.test(parsed.pathname)) {
      const base = parsed.pathname.split('/').pop() ?? '';
      const label = labels.get(base);
      fileName = label ? `${cleanName(label)}.${extensionOf(base)}` : `Attachment ${base}`;
    } else {
      continue; // pages such as the SLA viewer, not files
    }
    for (let copy = 2; usedNames.has(fileName.toLowerCase()); copy += 1) {
      fileName = fileName.replace(/( \(\d+\))?(\.[a-z0-9]+)$/i, ` (${copy})$2`);
    }
    usedNames.add(fileName.toLowerCase());
    attachments.push({ url, fileName });
  }
  return attachments;
}
