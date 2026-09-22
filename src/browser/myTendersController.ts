/// <reference lib="dom" />
import type { Page } from 'playwright-core';
import type { TenderRow } from '../persistence/repositories/tenderRepository.js';

export interface TenderDetailSnapshot {
  tenderPortalId: string | null;
  tenderReferenceNumber: string | null;
  tenderCategory: string | null;
  productCategories: string[];
  publishedDateRaw: string | null;
  organisationChain: string | null;
  bodyText: string;
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Navigate by clicking the portal's own menu item; never invent a direct URL. */
export async function navigateToMyTenders(page: Page): Promise<void> {
  const link = page.getByText('My Tenders', { exact: true }).first();
  await link.waitFor({ state: 'visible', timeout: 10_000 });
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

    const first = (...labels: string[]) =>
      entries.find((entry) => labels.includes(entry.label))?.value ?? null;
    const productCategories = Array.from(
      new Set(
        entries
          .filter((entry) => entry.label === 'product category')
          .map((entry) => entry.value)
          .filter(Boolean)
      )
    );

    return {
      tenderPortalId: first('tender id'),
      tenderReferenceNumber: first('tender reference number', 'tender reference no'),
      tenderCategory: first('tender category'),
      productCategories,
      publishedDateRaw: first('published date', 'e-published date'),
      organisationChain: first('organisation chain'),
      bodyText: compactText(document.body?.innerText),
    };
  });
}

/**
 * Opens the selected current-job row's View Tender Information link. The
 * real portal uses an untracked popup; the same-page fallback makes fixture
 * testing and defensive recovery possible without guessing a portal URL.
 */
export async function reviewTenderFromMyTenders(page: Page, tender: TenderRow): Promise<TenderDetailSnapshot> {
  const row = await findTenderRow(page, tender);
  if (!row) throw new Error(`Tender ${tender.tender_portal_id ?? tender.tender_ref} is not visible in My Tenders.`);

  const detailLink = row.locator('a:has(img[title*="View Tender Information" i])').first();
  if ((await detailLink.count()) === 0) {
    throw new Error(`Tender ${tender.tender_portal_id ?? tender.tender_ref} has no View Tender Information link.`);
  }

  const beforeUrl = page.url();
  const popupPromise = page.waitForEvent('popup', { timeout: 5_000 }).catch(() => null);
  await detailLink.click();
  const popup = await popupPromise;
  const detailPage = popup ?? page;
  await detailPage.waitForLoadState('load').catch(() => {});
  const details = await extractTenderDetails(detailPage);

  if (popup) {
    await popup.close().catch(() => {});
  } else if (page.url() !== beforeUrl) {
    await page.goBack({ waitUntil: 'load' }).catch(() => {});
  }

  return {
    ...details,
    tenderPortalId: compact(details.tenderPortalId ?? '') || tender.tender_portal_id,
    tenderReferenceNumber: compact(details.tenderReferenceNumber ?? '') || tender.tender_ref,
  };
}
