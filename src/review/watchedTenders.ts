import type { PortalCorrigendum } from './corrigenda.js';
import type { OpportunityLifecycle } from '../state/opportunityLifecycle.js';

// Closing dates get extended and corrigenda get published after a tender is
// found. GePNIC websites show both on the tender's own page:
//
//   Critical Dates ... Bid Submission End Date 06-Oct-2026 03:00 PM
//   Latest Corrigendum List S.No Corrigendum Title Corrigendum Type View
//     1 DUE DATE EXTENSION Date 2 PreBid Response1 Other
//
// Read live on Tamil Nadu (12 saved pages, 9 Oct 2026). The page text is
// flattened, so a row is "<number> <title> <type>", the type being one of
// GePNIC's few corrigendum types.

export interface TenderPageFacts {
  /** "06-Oct-2026 03:00 PM", as the website writes it; null when not on the page. */
  closingDateRaw: string | null;
  corrigenda: PortalCorrigendum[];
}

const CLOSING = /Bid Submission End Date\s+(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2}\s*[AP]M)/i;
const CORRIGENDUM_LIST = /Latest Corrigendum List\s+S\.?\s*No\.?\s+Corrigendum Title\s+Corrigendum Type(?:\s+View)?\s+([\s\S]*)/i;
// GePNIC's corrigendum types; a row's title runs up to its type.
const TYPES = 'Date|Fee|Technical|Others?|BOQ|Tender\\s+Document|Cancel(?:lation|led)?|Corrigendum|Retender';
const ROW = new RegExp(`(?:^|\\s)(\\d{1,3})\\s+(.+?)\\s+(${TYPES})(?=\\s+\\d{1,3}\\s|\\s*$)`, 'gi');
// Where the corrigendum table ends on the page.
const AFTER_LIST = /\s+(?:Tender Inviting Authority|Bid Openers|Tenders? Documents|Work Item Documents|Back|Print)\b/i;

export function tenderPageFacts(detailText: string | null | undefined): TenderPageFacts {
  const text = (detailText ?? '').replace(/\s+/g, ' ');
  const closingDateRaw = CLOSING.exec(text)?.[1] ?? null;
  const list = CORRIGENDUM_LIST.exec(text)?.[1] ?? '';
  const table = list.split(AFTER_LIST)[0] ?? '';
  const corrigenda: PortalCorrigendum[] = [];
  for (const match of table.matchAll(ROW)) {
    corrigenda.push({ portalNumber: match[1], title: match[2].trim(), description: match[3].trim(), publishedAt: null });
  }
  return { closingDateRaw, corrigenda };
}

/** After the closing date, keep checking this long: extensions often come at or just after the deadline. */
export const WATCH_AFTER_CLOSING_DAYS = 3;
/** A tender whose closing date is unknown is checked this long after it was first found. */
export const WATCH_UNKNOWN_CLOSING_DAYS = 30;

const DECIDED_TO_WATCH: readonly OpportunityLifecycle[] = ['APPROVED', 'DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'PREPARING', 'DEFERRED'];

export interface WatchCandidate {
  lifecycle: OpportunityLifecycle;
  recommendation: string | null;
  closing_at: string | null;
  first_seen_at: string;
}

/**
 * Tenders whose page is read again for extensions and corrigenda: approved,
 * "decide later", and waiting for the operator, while still open (or just
 * closed). Rejected tenders are not watched, by the operator's rules or by
 * hand; approving one later brings it back.
 */
export function isWatched(tender: WatchCandidate, now = new Date()): boolean {
  const waiting = (tender.lifecycle === 'NEW' || tender.lifecycle === 'SCREENED') && tender.recommendation !== 'REJECT';
  if (!waiting && !DECIDED_TO_WATCH.includes(tender.lifecycle)) return false;
  const day = 86_400_000;
  if (tender.closing_at) return Date.parse(tender.closing_at) + WATCH_AFTER_CLOSING_DAYS * day >= now.getTime();
  return Date.parse(tender.first_seen_at) + WATCH_UNKNOWN_CLOSING_DAYS * day >= now.getTime();
}

/** "Corrigenda" for the report sheet: "1. DUE DATE EXTENSION (Date); 2. PreBid Response1 (Other)". */
export function corrigendaSummary(corrigenda: readonly PortalCorrigendum[]): string {
  return corrigenda.map((entry) => `${entry.portalNumber ? `${entry.portalNumber}. ` : ''}${entry.title ?? ''}${entry.description ? ` (${entry.description})` : ''}`.trim()).join('; ');
}
