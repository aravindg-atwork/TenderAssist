export interface ParsedActiveTenderRow {
  serialNo: string;
  tenderId: string;
  title: string;
  referenceNumber: string;
  productCategory: string;
  valueInRupees: string;
}

// Real Search Active Tenders results table, captured live 2026-09-21 against
// an authenticated session: S.No | Tender ID | Tender Title | Tender
// Reference Number | Product Category | Value in Rs | Favorite. This is a
// DIFFERENT page/table than src/search/tenderRowParser.ts targets -- that
// file's cell shape (published/closing/opening dates, a bracket-embedded
// title) does not match this table at all, so this is a new, separately
// named parser rather than a repurposing of that one. See
// docs/superpowers/specs/2026-09-21-search-execution-design.md.
export function parseActiveTenderRow(cells: string[]): ParsedActiveTenderRow | null {
  if (cells.length < 6) return null;
  const [serialNo, tenderId, title, referenceNumber, productCategory, valueInRupees] = cells;

  return {
    serialNo: serialNo.trim(),
    tenderId: tenderId.trim(),
    title: title.trim(),
    referenceNumber: referenceNumber.trim(),
    productCategory: productCategory.trim(),
    valueInRupees: valueInRupees.trim(),
  };
}
