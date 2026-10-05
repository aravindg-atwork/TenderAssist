// What a tender's "file" shows: the portal's own fields read from its
// details page, the key ones first in plain names, and its documents.

export interface TenderField {
  label: string;
  value: string;
}

export interface TenderFileDocument {
  id: string;
  name: string;
  state: 'PENDING' | 'DOWNLOADED' | 'FAILED';
  error: string | null;
}

export interface TenderFileView {
  opportunityId: string;
  /** The key facts, in a fixed order, under plain names. */
  keyFacts: TenderField[];
  /** Every field the portal showed, as the portal names them. */
  allFields: TenderField[];
  documents: TenderFileDocument[];
  /** Whether a saved folder exists for this tender on this computer. */
  hasFolder: boolean;
  /** Whether its details page has been read at all. */
  detailsRead: boolean;
  /** What the portal's search list showed, before any details page was read. */
  listing: TenderField[];
  /** The published date it was found under, for searching that date again. */
  foundOnDate: string | null;
  /** Whether it was ticked into My Tenders, where the next search can read it. */
  inMyTenders: boolean;
}

/** The "Label: value" lines TenderAssist stores at the top of a tender's text. */
export function parseDetailFields(detailText: string | null | undefined): TenderField[] {
  if (!detailText) return [];
  const fields: TenderField[] = [];
  const seen = new Set<string>();
  for (const line of detailText.split('\n')) {
    if (!line.trim()) break; // the fields end at the first blank line; page text follows
    const match = /^([^:\n]{2,80}):\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const label = match[1].trim();
    const value = match[2].trim();
    if (/^(welcome|last login|server time)$/i.test(label) || /^:?$/.test(value)) continue;
    const key = `${label.toLowerCase()}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push({ label, value });
  }
  return fields;
}

// Plain names for the portal's labels, in the order the file shows them.
const KEY_FACTS: Array<{ name: string; label: RegExp }> = [
  { name: 'Work', label: /^work\s*description$/i },
  { name: 'Estimated value', label: /^tender\s*value/i },
  { name: 'EMD', label: /^emd\s*amount/i },
  { name: 'Tender fee', label: /^tender\s*fee\s*in/i },
  { name: 'Bids close', label: /^bid\s*submission\s*end\s*date$/i },
  { name: 'Bids open', label: /^bid\s*opening\s*date$/i },
  { name: 'Location', label: /^location$/i },
  { name: 'Work period (days)', label: /^period\s*of\s*work/i },
  { name: 'Eligibility', label: /^pre\s*-?\s*qualification/i },
  { name: 'Contract', label: /^form\s*of\s*contract$/i },
  { name: 'Organisation', label: /^organisation\s*chain$/i },
  { name: 'Contact', label: /^(?:name|inviting\s*officer)$/i },
];

const EMPTY_VALUE = /^(?:na|n\/a|nil|-+|0\.00)$/i;

export function keyFactsFrom(fields: TenderField[]): TenderField[] {
  const facts: TenderField[] = [];
  for (const fact of KEY_FACTS) {
    const found = fields.find((field) => fact.label.test(field.label) && !EMPTY_VALUE.test(field.value));
    if (found) facts.push({ label: fact.name, value: found.value.replace(/\|\|/g, ' › ') });
  }
  return facts;
}
