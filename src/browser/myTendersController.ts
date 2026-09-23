/// <reference lib="dom" />
import type { Page } from 'playwright-core';
import type { TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { PaceAction } from '../orchestration/actionPacer.js';

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
  documentLinks: Array<{ url: string; fileName: string }>;
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Navigate by clicking the portal's own menu item; never invent a direct URL. */
export async function navigateToMyTenders(page: Page, paceAction: PaceAction = noPacing): Promise<void> {
  const link = page.getByText('My Tenders', { exact: true }).first();
  await link.waitFor({ state: 'visible', timeout: 10_000 });
  await paceAction();
  await link.click();
  await page.waitForLoadState('load').catch(() => {});
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

    for (const row of Array.from(document.querySelectorAll('tr'))) {
      const cells = Array.from(row.children).filter((child) => child.matches('td, th')) as HTMLElement[];
      if (cells.length < 2) continue;
      const label = normalizedLabel(cells[0].innerText);
      const value = compactText(cells.slice(1).map((cell) => cell.innerText).join(' '));
      if (label && value) entries.push({ label, value });
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

    const documentLinks = Array.from(document.querySelectorAll('a[href]'))
      .map((anchor) => {
        const link = anchor as HTMLAnchorElement;
        const text = compactText(link.innerText || link.title || link.getAttribute('aria-label'));
        const href = link.href;
        const looksLikeDocument = /download|document|attachment|tender notice|boq|schedule|corrigendum|file/i.test(`${text} ${href}`);
        if (!looksLikeDocument || !href) return null;
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
      documentLinks: Array.from(new Map(documentLinks.map((item) => [item.url, item])).values()),
    };
  });
}

async function reviewTenderAtRow(
  page: Page,
  tender: TenderRow,
  row: Awaited<ReturnType<Page['locator']>>,
  paceAction: PaceAction = noPacing
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
  const detailPage = popup ?? page;
  await detailPage.waitForLoadState('load').catch(() => {});
  const details = await extractTenderDetails(detailPage);

  if (popup) {
    await popup.close().catch(() => {});
  } else if (page.url() !== beforeUrl) {
    await paceAction();
    await page.goBack({ waitUntil: 'load' }).catch(() => {});
  }

  return {
    ...details,
    tenderPortalId: compact(details.tenderPortalId ?? '') || tender.tender_portal_id,
    tenderReferenceNumber: compact(details.tenderReferenceNumber ?? '') || tender.tender_ref,
  };
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
      await candidate.click();
      await page.waitForLoadState('load').catch(() => {});
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
  paceAction: PaceAction = noPacing
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
        reviewed.set(tenderId, await reviewTenderAtRow(page, tender, row, paceAction));
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
