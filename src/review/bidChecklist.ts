// The bid checklist of an approved tender (what to prepare and upload), and
// the reminders for its dates. Both are worked out from what TenderAssist
// read; only the bidder's ticks and the reminders already shown are stored.

import type { QualificationSection } from '../extraction/qualificationSections.js';
import type { CoverDocuments } from './portalPage.js';

export interface ChecklistEntry {
  /** Stable for the same wording, so a tick survives the list being worked out again. */
  key: string;
  label: string;
  /** Where it came from: "GeM bid", "RFP.pdf, page 32", "Every bid". */
  from: string;
}

export interface ChecklistInput {
  /** The tender's own fields ("Documents Required from Seller", "EMD Amount in ₹", …). */
  fields: Array<{ label: string; value: string }>;
  sections: readonly QualificationSection[];
  gem: boolean;
  closingDate: string | null;
  /** What a GePNIC tender asks to upload in each cover (portalPage.coverDocuments). */
  covers?: CoverDocuments[];
}

function keyOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
}

function field(fields: ChecklistInput['fields'], label: RegExp): string | null {
  const found = fields.find((entry) => label.test(entry.label) && !/^(?:na|n\/a|nil|-+|0(?:\.0+)?)$/i.test(entry.value.trim()));
  return found ? found.value.trim() : null;
}

/** "Copy of PAN; Copy of GSTIN Certificate" in a criterion: the evidence it asks for. */
function evidenceIn(text: string): string[] {
  // Table captions ("Table 6: …") end a criterion's last cell.
  const flat = text.replace(/\s+/g, ' ').replace(/\s+Table \d+\s*:.*$/, '');
  // Only at the start of a clause, capitalised: "…years. Copy of PAN; Copy of GSTIN…", never "…proof is submitted".
  return [...flat.matchAll(/(?:^|[.;:]\s+|\s(?=(?:Copy|Proof|Self-certified|Citation) ))((?:Copy|Copies|Proof|Self[- ]certified|CA certificate|Audited|Undertaking|Citation|Completion (?:Letter|certificate)|Work Order)\b[^;.]{3,160})/g)]
    .map((match) => match[1].trim().replace(/\s+(?:and|&)$/i, ''))
    .filter((entry) => !/\bshall\b|\bwill\b/i.test(entry));
}

/**
 * What to prepare and upload for a tender, from its own fields and
 * documents, then what every bid needs. Repeats are dropped.
 */
export function checklistFor(input: ChecklistInput): ChecklistEntry[] {
  const entries: ChecklistEntry[] = [];
  const add = (label: string, from: string) => {
    const tidy = label.replace(/\s+/g, ' ').trim().replace(/[.,;]$/, '');
    if (tidy.length < 3) return;
    const key = keyOf(tidy);
    if (!entries.some((entry) => entry.key === key)) entries.push({ key, label: tidy, from });
  };

  // A GePNIC tender lists every file to upload, cover by cover: the most exact list there is.
  (input.covers ?? []).forEach((cover, index) => {
    for (const document of cover.documents) add(`Cover ${index + 1} (${cover.cover}): ${document.description} (${document.type})`, 'Tender page');
  });
  const sellerDocuments = field(input.fields, /^documents?\s+required\s+from\s+seller$/i);
  for (const part of sellerDocuments?.split(/,(?![^(]*\))/) ?? []) {
    // GeM lists "Additional Doc 1 (Requested in ATC)": the buyer's terms say what it is.
    add(part.replace(/\s*\(Requested in ATC\)/i, ' (as the buyer’s terms ask)'), 'GeM bid');
  }
  for (const section of input.sections.filter((entry) => entry.kind === 'DOCUMENTS_REQUIRED')) {
    for (const item of section.items.length > 0 ? section.items : []) add(item.replace(/^\d{1,2}[.)]?\s+/, ''), `${section.document}${section.page ? `, page ${section.page}` : ''}`);
  }
  for (const section of input.sections.filter((entry) => entry.kind === 'BUYER_TERMS')) {
    for (const item of section.items) {
      const ask = /^\d{1,2}\.\s*((?:Submit|Upload|Enclose|Furnish|Attach)\b[^.]{3,200})/i.exec(item.replace(/\s+/g, ' '));
      if (ask) add(ask[1], 'Buyer’s terms');
    }
  }
  const criteria = input.sections.find((entry) => entry.kind === 'PRE_QUALIFICATION');
  for (const item of criteria?.items ?? []) {
    for (const evidence of evidenceIn(item)) add(evidence, `${criteria!.document}${criteria!.page ? `, page ${criteria!.page}` : ''}`);
  }

  const emd = field(input.fields, /^emd\s*amount/i);
  if (emd) add(`EMD of ₹${emd} (or proof of exemption, such as Udyam registration)`, input.gem ? 'GeM bid' : 'Tender page');
  const fee = field(input.fields, /^tender\s*fee/i);
  if (fee) add(`Tender fee of ₹${fee}`, 'Tender page');
  add('Technical bid: every document the tender asks for, signed and stamped', 'Every bid');
  add('Price bid (BoQ or price schedule) filled in', 'Every bid');
  add(`Bid signed with the DSC and submitted${input.closingDate ? ` before ${input.closingDate}` : ''}`, 'Every bid');
  return entries;
}

export interface ReminderTender {
  opportunityId: string;
  title: string;
  /** UTC ISO. */
  closingAt: string | null;
  /** UTC ISO, when the tender holds a pre-bid meeting. */
  preBidAt: string | null;
}

export interface Reminder {
  opportunityId: string;
  key: string;
  title: string;
  body: string;
}

const HOUR = 3_600_000;

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * The reminders due now for tenders being bid for: a pre-bid meeting within
 * a day, closing within 3 days and within a day. Each key shows once.
 */
export function dueReminders(tenders: readonly ReminderTender[], sent: ReadonlySet<string>, now = new Date()): Reminder[] {
  const due: Reminder[] = [];
  const offer = (tender: ReminderTender, key: string, title: string, body: string) => {
    if (!sent.has(`${tender.opportunityId}|${key}`)) due.push({ opportunityId: tender.opportunityId, key, title, body });
  };
  for (const tender of tenders) {
    const left = (iso: string | null) => (iso ? Date.parse(iso) - now.getTime() : Number.NaN);
    const preBid = left(tender.preBidAt);
    if (preBid > 0 && preBid <= 24 * HOUR) offer(tender, `prebid:${tender.preBidAt}`, 'Pre-bid meeting soon', `${tender.title}: pre-bid meeting ${when(tender.preBidAt!)}.`);
    const closing = left(tender.closingAt);
    if (closing > 0 && closing <= 24 * HOUR) offer(tender, `close1:${tender.closingAt}`, 'Closes within a day', `${tender.title} closes ${when(tender.closingAt!)}. Submit before then.`);
    else if (closing > 0 && closing <= 72 * HOUR) offer(tender, `close3:${tender.closingAt}`, 'Closes in 3 days', `${tender.title} closes ${when(tender.closingAt!)}.`);
  }
  return due;
}
