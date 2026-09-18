export interface ParsedTenderRow {
  ePublishedDate: string;
  closingDate: string;
  openingDate: string;
  title: string;
  tenderReferenceNumber: string;
  tenderPortalId: string;
  organisationChain: string[];
}

// Real captured format: "[Title] [RefNo][TenderPortalId]" -- one space
// after the title's closing bracket, zero spaces between the ref-number
// and tender-portal-id brackets.
const TITLE_REF_ID_PATTERN = /^\[(.+)\]\s*\[([^\]]+)\]\[([^\]]+)\]$/;

export function parseTenderRow(cells: string[]): ParsedTenderRow | null {
  if (cells.length < 6) return null;
  const [, ePublishedDate, closingDate, openingDate, titleCell, organisationChainCell] = cells;

  const match = titleCell.trim().match(TITLE_REF_ID_PATTERN);
  if (!match) return null;
  const [, title, tenderReferenceNumber, tenderPortalId] = match;

  return {
    ePublishedDate: ePublishedDate.trim(),
    closingDate: closingDate.trim(),
    openingDate: openingDate.trim(),
    title: title.trim(),
    tenderReferenceNumber: tenderReferenceNumber.trim(),
    tenderPortalId: tenderPortalId.trim(),
    organisationChain: organisationChainCell
      .split('||')
      .map((part) => part.trim())
      .filter(Boolean),
  };
}
