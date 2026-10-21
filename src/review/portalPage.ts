// The "Label: value" lines TenderAssist saves at the top of a tender's text,
// read the same way everywhere. A GePNIC page (Tamil Nadu) lays its tables
// out as label | value cells too, so rows such as "1: SBI Bank", "S.No: Bank
// Name" and ".pdf: Self-attested PAN copy" were saved as fields beside the
// real ones; they are left out here, and the cover list is read as what it
// is: the documents to upload in each cover.

export interface PageField {
  label: string;
  value: string;
}

/** A table row or page chrome saved as a field, not a field of the tender. */
export function isTableRowField(label: string, value: string): boolean {
  const name = label.trim();
  return /^\d{1,3}\.?$/.test(name)
    || /^\.[a-z0-9]{2,5}$/i.test(name)
    || /^(?:s\.?\s*no\.?|sl\.?\s*no\.?|welcome|last login|server time|cover no|document type|description|document name)$/i.test(name)
    || name.includes('@')
    || /^:?$/.test(value.trim())
    // A document list's description and size in KB ("Tender Inviting Authority: 262.93"), not an amount.
    || (/^\d+\.\d{2}$/.test(value.trim()) && !/₹|amount|value|fee|emd|percent|%|rate|price/i.test(name));
}

/** Every "Label: value" line of the saved page's field block, in order, as saved. */
function rawFields(detailText: string | null | undefined): PageField[] {
  const fields: PageField[] = [];
  for (const line of (detailText ?? '').replace(/^\s*\n/, '').split('\n')) {
    if (!line.trim()) break; // the fields end at the first blank line; page text follows
    const match = /^([^:\n]{1,80}):\s+(.*)$/.exec(line.trim());
    if (match) fields.push({ label: match[1].trim(), value: match[2].trim() });
  }
  return fields;
}

/** The tender's own fields, without table rows and page chrome, each label and value once. */
export function tenderPageFields(detailText: string | null | undefined): PageField[] {
  const seen = new Set<string>();
  return rawFields(detailText).filter((field) => {
    if (isTableRowField(field.label, field.value)) return false;
    const key = `${field.label.toLowerCase()}|${field.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface CoverDocuments {
  /** "Fee/PreQual/Technical", "Finance". */
  cover: string;
  documents: Array<{ type: string; description: string }>;
}

/**
 * The documents a GePNIC tender asks to upload, cover by cover, from its
 * "Cover Details" table: "1: Fee/PreQual/Technical", then ".pdf: Self-attested
 * PAN copy, latest Income Tax Return filed", and so on.
 */
export function coverDocuments(detailText: string | null | undefined): CoverDocuments[] {
  const covers: CoverDocuments[] = [];
  let inCovers = false;
  for (const { label, value } of rawFields(detailText)) {
    if (/^cover no$/i.test(label) || /^document type$/i.test(label)) { inCovers = true; continue; }
    if (!inCovers) continue;
    if (/^\d{1,2}$/.test(label)) { covers.push({ cover: value, documents: [] }); continue; }
    if (/^\.[a-z0-9]{2,5}$/i.test(label) && covers.length > 0) { covers[covers.length - 1].documents.push({ type: label.slice(1).toUpperCase(), description: value }); continue; }
    break; // the next table ("Tender Fee in ₹") ends the covers
  }
  return covers.filter((cover) => cover.documents.length > 0);
}
