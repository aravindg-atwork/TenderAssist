/// <reference lib="dom" />
import type { Page } from 'playwright-core';
import type { TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { PaceAction } from '../orchestration/actionPacer.js';
import { ensurePortalMenu, submitAndWaitForNewPage } from './searchFormController.js';

const noPacing: PaceAction = async () => {};

export interface TenderDetailSnapshot {
  tenderPortalId: string | null;
  tenderReferenceNumber: string | null;
  tenderCategory: string | null;
  productCategories: string[];
  publishedDateRaw: string | null;
  organisationChain: string | null;
  department: string | null;
  stateName: string | null;
  bodyText: string;
  /** Every label and value on the page, in page order, as the portal shows them. */
  fields: Array<{ label: string; value: string }>;
  documentLinks: Array<{ url: string; fileName: string }>;
}

/**
 * The tender text kept for screening and the eligibility sheet: one
 * "Label: value" line per portal field, then the page text.
 */
export function detailTextFor(details: Pick<TenderDetailSnapshot, 'fields' | 'bodyText'>): string {
  const lines = details.fields.map((field) => `${field.label}: ${field.value}`);
  return lines.length > 0 ? `${lines.join('\n')}\n\n${details.bodyText}` : details.bodyText;
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Navigate by clicking the portal's own menu item; never invent a direct URL. */
export async function navigateToMyTenders(page: Page, paceAction: PaceAction = noPacing, portalHomeUrl?: string): Promise<void> {
  await ensurePortalMenu(page, 'My Tenders', portalHomeUrl, paceAction);
  const link = page.getByText('My Tenders', { exact: true }).first();
  await link.waitFor({ state: 'visible', timeout: 10_000 });
  await paceAction();
  // Read nothing until My Tenders itself has loaded, not the page before it.
  await submitAndWaitForNewPage(page, () => link.click());
}

async function findTenderRow(page: Page, tender: TenderRow) {
  const identifiers = [tender.tender_portal_id, tender.tender_ref].filter(
    (value): value is string => Boolean(value?.trim())
  );
  for (const identifier of identifiers) {
    const row = page.locator('tr').filter({ hasText: identifier }).last();
    if ((await row.count()) > 0) return row;
  }
  return null;
}

async function extractTenderDetails(detailPage: Page): Promise<TenderDetailSnapshot> {
  return detailPage.evaluate(() => {
    const compactText = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ');
    const normalizedLabel = (value: string) => compactText(value).replace(/\s*:\s*$/, '').toLocaleLowerCase();
    const entries: Array<{ label: string; value: string }> = [];
    const fields: Array<{ label: string; value: string }> = [];
    const seenFields = new Set<string>();
    const addField = (rawLabel: string, rawValue: string) => {
      const label = compactText(rawLabel).replace(/\s*:\s*$/, '');
      const value = compactText(rawValue);
      if (!label || !value || label.length > 80) return;
      entries.push({ label: label.toLocaleLowerCase(), value });
      const key = `${label.toLocaleLowerCase()}|${value}`;
      if (!seenFields.has(key)) {
        seenFields.add(key);
        fields.push({ label, value });
      }
    };

    // Only innermost rows: an outer layout row contains the whole page.
    for (const row of Array.from(document.querySelectorAll('tr'))) {
      if (row.querySelector('tr')) continue;
      const cells = Array.from(row.children).filter((child) => child.matches('td, th')) as HTMLElement[];
      if (cells.length < 2) continue;
      // The portal lays fields out as label | value | label | value.
      if (cells.length % 2 === 0) {
        for (let index = 0; index < cells.length; index += 2) addField(cells[index].innerText, cells[index + 1].innerText);
      } else {
        addField(cells[0].innerText, cells.slice(1).map((cell) => cell.innerText).join(' '));
      }
    }

    const bodyRaw = document.body?.innerText ?? '';
    const lines = bodyRaw.split(/\r?\n/).map(compactText).filter(Boolean);
    for (let index = 0; index < lines.length - 1; index += 1) {
      const label = normalizedLabel(lines[index]);
      if (!label || label.length > 80) continue;
      if (/^(tender id|tender reference|tender category|product category|published date|e-published date|organisation chain|department name|department|state)/.test(label)) {
        entries.push({ label, value: lines[index + 1] });
      }
    }

    const first = (...labels: string[]) =>
      entries.find((entry) => labels.some((label) => entry.label === label || entry.label.startsWith(`${label} `)))?.value ?? null;
    const productCategories = Array.from(
      new Set(
        entries
          .filter((entry) => entry.label === 'product category' || entry.label.startsWith('product category '))
          .map((entry) => entry.value)
          .filter(Boolean)
      )
    );

    const publishedFromLabel = first('published date', 'e-published date');
    const publishedFromBody = bodyRaw.match(
      /(?:e-?published|published)\s+date\s*:?\s*(\d{1,2}-[a-z]{3}-\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm))/i
    )?.[1] ?? null;

    // Only the tender's own files: names with a file extension in the NIT
    // and Work Item tables (Tendernotice_1.pdf, BOQ_845450.xls) and the
    // "Download as zip file" link. Menu items such as "Downloads" are not.
    const documentLinks = Array.from(document.querySelectorAll('a[href]'))
      .map((anchor) => {
        const link = anchor as HTMLAnchorElement;
        const text = compactText(link.innerText || link.title || link.getAttribute('aria-label'));
        const href = link.href;
        const looksLikeDocument = /\.(?:pdf|xlsx?|docx?|zip|rar|7z|dwg|jpe?g|png|txt|csv)$/i.test(text) || /download\s+as\s+zip/i.test(text);
        if (!looksLikeDocument || !href || /^javascript:\s*void/i.test(href)) return null;
        const urlName = (() => {
          try { return decodeURIComponent(new URL(href).pathname.split('/').pop() || 'tender-document'); }
          catch { return 'tender-document'; }
        })();
        return { url: href, fileName: compactText(text) || urlName };
      })
      .filter((item): item is { url: string; fileName: string } => Boolean(item));

    return {
      tenderPortalId: first('tender id'),
      tenderReferenceNumber: first('tender reference number', 'tender reference no'),
      tenderCategory: first('tender category'),
      productCategories,
      publishedDateRaw: publishedFromLabel ?? publishedFromBody,
      organisationChain: first('organisation chain'),
      department: first('department name', 'department'),
      stateName: first('state'),
      bodyText: compactText(bodyRaw),
      fields,
      documentLinks: Array.from(new Map(documentLinks.map((item) => [item.url, item])).values()),
    };
  });
}

/** Runs while a tender's details page is still open, e.g. to decide and download its documents. */
export type WhileDetailOpen = (tender: TenderRow, details: TenderDetailSnapshot, detailPage: Page) => Promise<void>;

async function reviewTenderAtRow(
  page: Page,
  tender: TenderRow,
  row: Awaited<ReturnType<Page['locator']>>,
  paceAction: PaceAction = noPacing,
  whileOpen?: WhileDetailOpen,
  /** Returns to the list after details opened in the same page; defaults to the browser's Back. */
  returnToList?: () => Promise<void>
): Promise<TenderDetailSnapshot> {
  let detailLink = row.locator('a:has(img[title*="View Tender Information" i]), a[title*="View Tender Information" i]').first();
  if ((await detailLink.count()) === 0) {
    detailLink = row.locator('td').nth(2).locator('a[href]').first();
  }
  if ((await detailLink.count()) === 0) {
    detailLink = row.locator('td').nth(1).locator('a[href]').first();
  }
  if ((await detailLink.count()) === 0) {
    throw new Error(`Tender ${tender.tender_portal_id ?? tender.tender_ref} has no View Tender Information link.`);
  }

  const beforeUrl = page.url();
  const popupPromise = page.waitForEvent('popup', { timeout: 5_000 }).catch(() => null);
  const samePageNavigation = page
    .waitForURL((url) => url.toString() !== beforeUrl, { timeout: 5_000 })
    .then(() => null)
    .catch(() => null);
  await paceAction();
  await detailLink.click();
  const popup = await Promise.race([popupPromise, samePageNavigation]);
  // Neither a pop-up nor a new page: reading on would take the results page
  // for the tender's details.
  if (!popup && page.url() === beforeUrl) {
    throw new Error(`The details of tender ${tender.tender_portal_id ?? tender.tender_ref} did not open.`);
  }
  const detailPage = popup ?? page;
  let details: TenderDetailSnapshot;
  try {
    // A pop-up starts on a blank page before it reaches the tender.
    if (popup) await popup.waitForURL((url) => url.href !== 'about:blank', { timeout: 15_000 }).catch(() => {});
    await detailPage.waitForLoadState('load').catch(() => {});
    details = await extractTenderDetails(detailPage).catch(async (error: unknown) => {
      // The page moved on mid-read; read it again once it has loaded.
      if (!/context was destroyed|navigat/i.test(error instanceof Error ? error.message : String(error))) throw error;
      await detailPage.waitForLoadState('load').catch(() => {});
      return extractTenderDetails(detailPage);
    });
    details = {
      ...details,
      tenderPortalId: compact(details.tenderPortalId ?? '') || tender.tender_portal_id,
      tenderReferenceNumber: compact(details.tenderReferenceNumber ?? '') || tender.tender_ref,
    };
    await whileOpen?.(tender, details, detailPage);
  } finally {
    // Always close the pop-up: the portal re-uses one named window, so a
    // pop-up left open makes the next tender's details never appear.
    if (popup) await popup.close().catch(() => {});
  }

  if (!popup && page.url() !== beforeUrl) {
    if (returnToList) {
      await returnToList();
    } else {
      await paceAction();
      await page.goBack({ waitUntil: 'load' }).catch(() => {});
    }
  }

  return details;
}

async function goToNextPage(page: Page, paceAction: PaceAction): Promise<boolean> {
  const selectors = [
    'a:has(img[title*="Next" i])',
    'a:has(img[alt*="Next" i])',
    'a[title*="Next" i]',
    'input[title*="Next" i]',
    'button[title*="Next" i]',
  ];

  for (const selector of selectors) {
    const candidates = page.locator(selector);
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const disabled = await candidate.isDisabled().catch(() => false);
      const ariaDisabled = await candidate.getAttribute('aria-disabled');
      const className = (await candidate.getAttribute('class')) ?? '';
      if (disabled || ariaDisabled === 'true' || /\bdisabled\b/i.test(className)) continue;
      await paceAction();
      await submitAndWaitForNewPage(page, () => candidate.click()).catch(() => {});
      return true;
    }
  }
  return false;
}

export interface TenderReviewBatch {
  reviewed: Map<string, TenderDetailSnapshot>;
  /** Tenders not reviewed, and why. A `NotInMyTendersError` means it is not in My Tenders at all. */
  errors: Map<string, Error>;
  pagesScanned: number;
}

/**
 * A favourite that is not in My Tenders on the portal, checked twice: it was
 * closed, withdrawn, or removed from My Tenders. Not a page that failed.
 */
export class NotInMyTendersError extends Error {
  constructor(tender: TenderRow) {
    super(`Tender ${tender.tender_portal_id ?? tender.tender_ref} is no longer in My Tenders on the portal.`);
    this.name = 'NotInMyTendersError';
  }
}

interface ScanResult {
  reviewed: Map<string, TenderDetailSnapshot>;
  /** Found in My Tenders, but its details could not be read. */
  failed: Map<string, Error>;
  /** Not seen on any page. */
  notFound: Set<string>;
  pagesScanned: number;
}

/** One pass through every page of My Tenders, from the page open now. */
async function scanMyTenders(
  page: Page,
  tenders: TenderRow[],
  maxPages: number,
  paceAction: PaceAction,
  whileOpen: WhileDetailOpen | undefined,
  portalHomeUrl: string | undefined
): Promise<ScanResult> {
  const pending = new Map(tenders.map((tender) => [tender.id, tender]));
  const reviewed = new Map<string, TenderDetailSnapshot>();
  const failed = new Map<string, Error>();
  const seenPages = new Set<string>();
  let pagesScanned = 0;

  while (pending.size > 0 && pagesScanned < maxPages) {
    const pageText = await page.locator('body').innerText().catch(() => '');
    const signature = `${page.url()}\n${compact(pageText).slice(0, 1200)}`;
    if (seenPages.has(signature)) break;
    seenPages.add(signature);
    pagesScanned += 1;

    for (const [tenderId, tender] of Array.from(pending.entries())) {
      const row = await findTenderRow(page, tender);
      if (!row) continue;
      try {
        // In My Tenders the details open in the same page. The browser's Back
        // did not reliably return to the list, which left every later tender
        // "not found"; the portal's own My Tenders link always does.
        reviewed.set(tenderId, await reviewTenderAtRow(page, tender, row, paceAction, whileOpen, () => navigateToMyTenders(page, paceAction, portalHomeUrl)));
      } catch (error) {
        failed.set(tenderId, error instanceof Error ? error : new Error(String(error)));
      }
      pending.delete(tenderId);
    }

    if (pending.size === 0 || !(await goToNextPage(page, paceAction))) break;
  }
  return { reviewed, failed, notFound: new Set(pending.keys()), pagesScanned };
}

/**
 * Review every current-job favourite across all pages in My Tenders. Any
 * tender not found, or whose details did not open, gets a second pass from a
 * freshly opened My Tenders: a slow portal or a list that did not come back
 * properly should not cost a tender. Only a tender missing from both passes
 * is reported as not in My Tenders.
 */
export async function reviewTendersFromMyTenders(
  page: Page,
  tenders: TenderRow[],
  maxPages = 100,
  paceAction: PaceAction = noPacing,
  whileOpen?: WhileDetailOpen,
  portalHomeUrl?: string
): Promise<TenderReviewBatch> {
  const first = await scanMyTenders(page, tenders, maxPages, paceAction, whileOpen, portalHomeUrl);
  const reviewed = new Map(first.reviewed);
  let pagesScanned = first.pagesScanned;
  const leftOver = tenders.filter((tender) => !reviewed.has(tender.id));
  let second: ScanResult | null = null;
  if (leftOver.length > 0) {
    const reopened = await navigateToMyTenders(page, paceAction, portalHomeUrl).then(() => true, () => false);
    if (reopened) {
      second = await scanMyTenders(page, leftOver, maxPages, paceAction, whileOpen, portalHomeUrl);
      for (const [id, details] of second.reviewed) reviewed.set(id, details);
      pagesScanned += second.pagesScanned;
    }
  }

  const errors = new Map<string, Error>();
  for (const tender of leftOver) {
    if (reviewed.has(tender.id)) continue;
    const failure = second?.failed.get(tender.id) ?? first.failed.get(tender.id);
    const missingBothTimes = first.notFound.has(tender.id) && (!second || second.notFound.has(tender.id));
    errors.set(tender.id, failure && !missingBothTimes
      ? failure
      : second ? new NotInMyTendersError(tender)
        : new Error(`Tender ${tender.tender_portal_id ?? tender.tender_ref} was not found, and My Tenders could not be opened again to check.`));
  }
  return { reviewed, errors, pagesScanned };
}

/** A GePNIC Tender ID, such as 2026_TNPL_708123_1. */
const TENDER_ID_PATTERN = /\b\d{4}_[A-Za-z0-9]+_\d+_\d+\b/;

const PORTAL_DATE_PATTERN = /\b(\d{2})-([A-Za-z]{3})-(\d{4})\s+\d{1,2}:\d{2}\s*[AP]M\b/gi;
const MONTH_NUMBERS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

export interface MyTendersRow {
  tenderPortalId: string;
  /**
   * The e-Published day (YYYY-MM-DD) when the row shows its three dates
   * (published, closing, opening, in that order, as GePNIC lists do); null
   * when it cannot be told from the row.
   */
  publishedDay: string | null;
}

/** A My Tenders row's Tender ID and, when the row shows it, its published day. */
export function parseMyTendersRow(text: string): MyTendersRow | null {
  const id = TENDER_ID_PATTERN.exec(text)?.[0];
  if (!id) return null;
  const dates = [...text.matchAll(PORTAL_DATE_PATTERN)];
  const first = dates.length >= 3 ? dates[0] : null;
  const month = first ? MONTH_NUMBERS[first[2].toLowerCase()] : undefined;
  return { tenderPortalId: id, publishedDay: first && month ? `${first[3]}-${month}-${first[1]}` : null };
}

/** The tenders in the innermost rows of the page open now, in page order. */
async function tenderRowsOnPage(page: Page): Promise<MyTendersRow[]> {
  const texts = await page.evaluate(() => Array.from(document.querySelectorAll('tr'))
    .filter((tr) => !tr.querySelector('tr') && tr.querySelectorAll('td').length > 1)
    // Cell by cell: a row's own text runs the cells together ("2026_X_1_1Title").
    .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? '').join(' '))).catch((): string[] => []);
  const rows: MyTendersRow[] = [];
  for (const text of texts) {
    const row = parseMyTendersRow(text);
    if (row && !rows.some((seen) => seen.tenderPortalId === row.tenderPortalId)) rows.push(row);
  }
  return rows;
}

export interface OwnFavouritesResult {
  /** Tender IDs whose details were read. */
  reviewed: string[];
  /** Tender IDs whose details could not be read, and why. */
  failed: Map<string, Error>;
  /** Tender IDs left alone because the list shows another published day. */
  otherDays: string[];
}

/**
 * Reads the tenders in My Tenders that TenderAssist did not put there: the
 * operator favourited them on the website by hand (owner, 27 Oct 2026: such
 * a tender was never found by a search, so it never reached Tenders or the
 * sheet). `isKnown` tells TenderAssist's own favourites apart. After each
 * tender the list is opened again from its first page, as the portal's own
 * My Tenders link does, so the scan starts over and skips what it read.
 */
export async function reviewOwnFavouritesInMyTenders(
  page: Page,
  isKnown: (tenderPortalId: string) => boolean,
  whileOpen: WhileDetailOpen,
  options: {
    maxPages?: number;
    maxTenders?: number;
    paceAction?: PaceAction;
    portalHomeUrl?: string;
    /** Only tenders published on this day (YYYY-MM-DD) are opened, when the list shows the day. */
    publishedOn?: string;
  } = {}
): Promise<OwnFavouritesResult> {
  const { maxPages = 100, maxTenders = 500, paceAction = noPacing, portalHomeUrl, publishedOn } = options;
  const reviewed: string[] = [];
  const failed = new Map<string, Error>();
  const otherDays: string[] = [];
  const done = new Set<string>();
  const reopen = () => navigateToMyTenders(page, paceAction, portalHomeUrl);
  let pageIndex = 0;
  while (reviewed.length + failed.size < maxTenders && pageIndex < maxPages) {
    let next: string | undefined;
    for (const row of await tenderRowsOnPage(page)) {
      const id = row.tenderPortalId;
      if (done.has(id) || isKnown(id)) continue;
      if (publishedOn && row.publishedDay && row.publishedDay !== publishedOn) {
        done.add(id);
        otherDays.push(id);
        continue;
      }
      next = id;
      break;
    }
    if (!next) {
      if (!(await goToNextPage(page, paceAction))) break;
      pageIndex += 1;
      continue;
    }
    done.add(next);
    const stub = { id: `my-tenders:${next}`, tender_portal_id: next, tender_ref: next, title: next } as TenderRow;
    try {
      const row = await findTenderRow(page, stub);
      if (!row) throw new Error(`Tender ${next} is not visible in My Tenders.`);
      await reviewTenderAtRow(page, stub, row, paceAction, whileOpen, reopen);
      reviewed.push(next);
    } catch (error) {
      failed.set(next, error instanceof Error ? error : new Error(String(error)));
    }
    // Back on the first page: walk to the page this tender was on.
    if (!(await reopen().then(() => true, () => false))) break;
    for (let index = 0; index < pageIndex; index += 1) {
      if (!(await goToNextPage(page, paceAction))) break;
    }
  }
  return { reviewed, failed, otherDays };
}

/**
 * Opens the selected current-job row's View Tender Information link. The
 * real portal uses an untracked popup; the same-page fallback makes fixture
 * testing and defensive recovery possible without guessing a portal URL.
 */
export async function reviewTenderFromMyTenders(page: Page, tender: TenderRow, paceAction: PaceAction = noPacing): Promise<TenderDetailSnapshot> {
  const row = await findTenderRow(page, tender);
  if (!row) throw new Error(`Tender ${tender.tender_portal_id ?? tender.tender_ref} is not visible in My Tenders.`);
  return reviewTenderAtRow(page, tender, row, paceAction);
}

/** Opens a candidate's detail link while still on Search Active Tenders. */
export async function reviewTenderFromSearchResults(page: Page, tender: TenderRow, paceAction: PaceAction = noPacing): Promise<TenderDetailSnapshot> {
  const row = await findTenderRow(page, tender);
  if (!row) throw new Error(`Tender ${tender.tender_portal_id ?? tender.tender_ref} is not visible in search results.`);
  return reviewTenderAtRow(page, tender, row, paceAction);
}

export interface DetailDocumentResult {
  url: string;
  fileName: string;
  /** Where the file was saved, when it downloaded. */
  filePath?: string;
  error?: string;
}

/** Starts a file download with `click` and resolves with where it was saved. */
export type CaptureDownload = (click: () => Promise<void>) => Promise<{ filePath: string; fileName: string }>;

/**
 * Clicks each document on an open tender details page, the way an operator
 * would: every file in the NIT and Work Item tables, then "Download as zip
 * file". The portal's links only work from the live page, so files are not
 * fetched separately. One file at a time; a failure is recorded and the
 * rest still download.
 */
export async function downloadDetailDocuments(
  detailPage: Page,
  capture: CaptureDownload,
  paceAction: PaceAction = noPacing
): Promise<DetailDocumentResult[]> {
  // Marks each document link so it can be clicked again; repeated after
  // returning to the page, since going back reloads it without the marks.
  const markLinks = () => detailPage.evaluate(() => {
    const compactText = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ');
    return Array.from(document.querySelectorAll('a[href]')).flatMap((anchor, index) => {
      const link = anchor as HTMLAnchorElement;
      const text = compactText(link.innerText || link.title);
      const isFile = /\.(?:pdf|xlsx?|docx?|zip|rar|7z|dwg|jpe?g|png|txt|csv)$/i.test(text);
      const isZip = /download\s+as\s+zip/i.test(text);
      if ((!isFile && !isZip) || /^javascript:\s*void/i.test(link.href)) return [];
      link.setAttribute('data-tenderassist-document', String(index));
      return [{ marker: String(index), url: link.href, fileName: text, isZip }];
    });
  });
  const links = await markLinks();
  // Individual files first; the zip, usually the largest, last.
  links.sort((a, b) => Number(a.isZip) - Number(b.isZip));

  const results: DetailDocumentResult[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    const detailUrl = detailPage.url();
    try {
      await paceAction();
      const saved = await capture(() => detailPage.locator(`a[data-tenderassist-document="${link.marker}"]`).first().click());
      results.push({ url: link.url, fileName: saved.fileName, filePath: saved.filePath });
    } catch (error) {
      results.push({ url: link.url, fileName: link.fileName, error: error instanceof Error ? error.message : String(error) });
    }
    // A link that opened a page (for example a CAPTCHA) instead of a file:
    // return to the tender so the next file can be clicked.
    if (detailPage.url() !== detailUrl) {
      await detailPage.goBack({ waitUntil: 'load' }).catch(() => {});
      await markLinks().catch(() => []);
    }
  }
  return results;
}

/**
 * Opens each listed corrigendum ("Latest Corrigendum List", its View link)
 * on an open tender details page and saves the files it shows, then returns
 * to the tender. The View link may open the corrigendum in the same page or
 * in a popup; both are handled. A corrigendum that cannot be opened is
 * reported with an error and the rest still save.
 */
export async function downloadCorrigendumDocuments(
  detailPage: Page,
  portalNumbers: readonly string[],
  captureFor: (portalNumber: string) => CaptureDownload,
  paceAction: PaceAction = noPacing
): Promise<Map<string, { results: DetailDocumentResult[]; error?: string }>> {
  const saved = new Map<string, { results: DetailDocumentResult[]; error?: string }>();
  const markRows = () => detailPage.evaluate((wanted) => {
    const compactText = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ');
    // The smallest table holding the corrigendum list, not the page-layout tables around it.
    const tables = Array.from(document.querySelectorAll('table'))
      .filter((table) => /Corrigendum Title/i.test(table.innerText) && /Corrigendum Type/i.test(table.innerText))
      .sort((a, b) => a.outerHTML.length - b.outerHTML.length);
    const table = tables[0];
    if (!table) return [] as string[];
    const marked: string[] = [];
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const number = compactText(row.querySelector('td')?.textContent);
      const link = row.querySelector('a[href], a[onclick]');
      if (!link || !wanted.includes(number)) continue;
      link.setAttribute('data-tenderassist-corrigendum', number);
      marked.push(number);
    }
    return marked;
  }, [...portalNumbers]);

  let marked = await markRows().catch(() => [] as string[]);
  for (const number of portalNumbers) {
    if (!marked.includes(number)) {
      saved.set(number, { results: [], error: 'Its View link was not found on the tender page.' });
      continue;
    }
    const detailUrl = detailPage.url();
    try {
      await paceAction();
      const popup = detailPage.context().waitForEvent('page', { timeout: 8_000 }).catch(() => null);
      await detailPage.locator(`[data-tenderassist-corrigendum="${number}"]`).first().click();
      const opened = await popup;
      const corrigendumPage = opened ?? detailPage;
      await corrigendumPage.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
      const results = await downloadDetailDocuments(corrigendumPage, captureFor(number), paceAction);
      saved.set(number, { results });
      if (opened) await opened.close().catch(() => {});
    } catch (error) {
      saved.set(number, { results: [], error: error instanceof Error ? error.message : String(error) });
    }
    if (detailPage.url() !== detailUrl) {
      await detailPage.goBack({ waitUntil: 'load' }).catch(() => {});
      marked = await markRows().catch(() => [] as string[]);
    }
  }
  return saved;
}
