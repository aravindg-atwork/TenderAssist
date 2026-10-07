// One bid as GeM's public bid list (bidplus.gem.gov.in/all-bids-data) returns
// it, and the plain record TenderAssist keeps. See docs/gem-portal.md.

/** A record from GeM's list. Every value comes wrapped in a one-item array. */
export interface GemListDoc {
  id?: string;
  b_id?: number[];
  b_bid_number?: string[];
  b_category_name?: string[];
  bd_category_name?: string[];
  b_total_quantity?: number[];
  b_status?: number[];
  b_bid_type?: number[];
  b_eval_type?: number[];
  b_bid_number_parent?: string[];
  b_id_parent?: number[];
  b_cat_id?: string[];
  final_start_date_sort?: string[];
  final_end_date_sort?: string[];
  ba_official_details_minName?: string[];
  ba_official_details_deptName?: string[];
  is_high_value?: boolean[];
  is_rc_bid?: number[];
  ba_is_global_tendering?: number[];
}

export type GemBidKind = 'BID' | 'RA' | 'DIRECT_RA';

export interface GemBid {
  /** GeM's internal id, used in every link. */
  id: string;
  /** As GeM shows it, such as GEM/2026/B/7993226. */
  bidNumber: string;
  kind: GemBidKind;
  /** The longest description GeM gives in its list. */
  title: string;
  /** The item or service as GeM's list names it. */
  itemName: string;
  /** The GeM category the item belongs to, such as "Custom Bid for Services". */
  category: string;
  categoryCode: string | null;
  ministry: string | null;
  department: string | null;
  /** Indian time, as `YYYY-MM-DDTHH:MM:SS` (see `istWallClock`). */
  startsAt: string | null;
  endsAt: string | null;
  quantity: number | null;
  /** For a reverse auction, the bid it came from. */
  parentBidNumber: string | null;
  cancelled: boolean;
  highValue: boolean;
  rateContract: boolean;
  globalTender: boolean;
}

const BID_ORIGIN = 'https://bidplus.gem.gov.in';

function first<T>(values: T[] | undefined): T | undefined {
  return Array.isArray(values) ? values[0] : undefined;
}

function text(values: string[] | undefined): string | null {
  const value = first(values);
  const clean = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return clean && !/^(?:na|n\/a|null|-+)$/i.test(clean) ? clean : null;
}

/**
 * GeM's dates are Indian time with a wrong `Z` on the end; its own page shows
 * them with timeZone 'UTC'. Keep the wall-clock time and drop the `Z`.
 */
export function istWallClock(raw: string | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(raw ?? '');
  return match ? `${match[1]}T${match[2]}` : null;
}

/**
 * The category part of an item name: everything before the first " - ".
 * "Facility Management Services - LumpSum Based - Residential; …" belongs to
 * "Facility Management Services".
 */
export function categoryOf(itemName: string): string {
  return itemName.split(' - ')[0].replace(/\s+/g, ' ').trim();
}

export function sameCategory(a: string, b: string): boolean {
  const key = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  return key(a) === key(b);
}

export function parseGemBid(doc: GemListDoc): GemBid | null {
  const id = first(doc.b_id) ?? (doc.id ? Number(doc.id) : undefined);
  const bidNumber = text(doc.b_bid_number);
  if (!id || !bidNumber) return null;
  const type = first(doc.b_bid_type);
  const itemName = text(doc.b_category_name) ?? '';
  const status = first(doc.b_status);
  return {
    id: String(id),
    bidNumber,
    kind: type === 5 ? 'DIRECT_RA' : type === 2 ? 'RA' : 'BID',
    title: text(doc.bd_category_name) ?? itemName,
    itemName,
    category: categoryOf(itemName),
    categoryCode: text(doc.b_cat_id),
    ministry: text(doc.ba_official_details_minName),
    department: text(doc.ba_official_details_deptName),
    startsAt: istWallClock(first(doc.final_start_date_sort)),
    endsAt: istWallClock(first(doc.final_end_date_sort)),
    quantity: typeof first(doc.b_total_quantity) === 'number' ? first(doc.b_total_quantity)! : null,
    parentBidNumber: text(doc.b_bid_number_parent),
    cancelled: status === 3 || status === 5,
    highValue: first(doc.is_high_value) === true,
    rateContract: first(doc.is_rc_bid) === 1,
    globalTender: first(doc.ba_is_global_tendering) === 1,
  };
}

/** The bid's own PDF, which holds every detail of the bid and links to its attachments. */
export function bidDocumentUrl(bid: Pick<GemBid, 'id' | 'kind'>): string {
  const path = bid.kind === 'DIRECT_RA' ? 'showdirectradocumentPdf' : bid.kind === 'RA' ? 'showradocumentPdf' : 'showbidDocument';
  return `${BID_ORIGIN}/${path}/${bid.id}`;
}

export function bidKindLabel(bid: Pick<GemBid, 'kind' | 'rateContract' | 'globalTender'>): string {
  const base = bid.kind === 'BID' ? 'Bid' : bid.kind === 'RA' ? 'Reverse auction' : 'Direct reverse auction';
  const extras = [bid.rateContract && 'rate contract', bid.globalTender && 'global tender'].filter(Boolean);
  return extras.length > 0 ? `${base} (${extras.join(', ')})` : base;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A GeM time in the form the GePNIC sites use ("07-Oct-2026 12:00 PM"), so
 * closing dates read, sort and expire the same way for every website.
 */
export function portalStyleDate(wallClock: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wallClock ?? '');
  if (!match) return null;
  const [, year, month, day, hourText, minute] = match;
  const hour = Number(hourText);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${day}-${MONTHS[Number(month) - 1]}-${year} ${String(twelve).padStart(2, '0')}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** An ISO time with the Indian offset, for the published-date column. */
export function istIso(wallClock: string | null): string | null {
  return wallClock ? `${wallClock}+05:30` : null;
}

/**
 * GeM changes the example it adds to a category's name ("Software Support
 * Services 2.0 - Microsoft; …" becomes "… - Sap; …"). A chosen name no longer
 * on GeM's list is replaced by the one entry of the same category that is,
 * so choices do not go stale. Names with no single match are kept as they are.
 */
export function refreshCategoryNames(chosen: readonly string[], list: readonly string[]): string[] {
  const key = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  const onList = new Set(list.map(key));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const name of chosen) {
    let next = name;
    if (!onList.has(key(name))) {
      const family = key(categoryOf(name));
      const same = list.filter((entry) => key(categoryOf(entry)) === family);
      if (same.length === 1) next = same[0];
    }
    if (seen.has(key(next))) continue;
    seen.add(key(next));
    result.push(next);
  }
  return result;
}
