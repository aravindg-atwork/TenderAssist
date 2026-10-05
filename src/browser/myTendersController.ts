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
  errors: Map<string, Error>;
  pagesScanned: number;
}

/** Review every current-job favorite across all pages in My Tenders. */
export async function reviewTendersFromMyTenders(
  page: Page,
  tenders: TenderRow[],
  maxPages = 100,
  paceAction: PaceAction = noPacing,
  whileOpen?: WhileDetailOpen,
  portalHomeUrl?: string
): Promise<TenderReviewBatch> {
  const pending = new Map(tenders.map((tender) => [tender.id, tender]));
  const reviewed = new Map<string, TenderDetailSnapshot>();
  const errors = new Map<string, Error>();
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
        errors.set(tenderId, error instanceof Error ? error : new Error(String(error)));
      }
      pending.delete(tenderId);
    }

    if (pending.size === 0 || !(await goToNextPage(page, paceAction))) break;
  }

  for (const [tenderId, tender] of pending) {
    errors.set(
      tenderId,
      new Error(
        `Tender ${tender.tender_portal_id ?? tender.tender_ref} was not found after scanning ${pagesScanned} My Tenders page(s).`
      )
    );
  }

  return { reviewed, errors, pagesScanned };
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
