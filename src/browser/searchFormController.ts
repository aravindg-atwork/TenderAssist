/// <reference lib="dom" />
// src/browser/searchFormController.ts
import type { Page, Dialog } from 'playwright-core';
import { parseActiveTenderRow, type ParsedActiveTenderRow } from '../search/activeTenderRowParser.js';

/**
 * Runs one category's search: clicks back to Search Active Tenders (a real
 * click -- consistent with never navigating directly to a portal URL),
 * selects the category, sets Date Criteria to Published Date with both
 * From/To set to the given date (the fromDate/toDate inputs are readonly,
 * JS-calendar-driven fields -- confirmed live 2026-09-21 -- so their value
 * is set directly via evaluate() rather than fill(), which Playwright
 * refuses on a readonly element), submits, and parses every result row.
 */
export async function searchCategory(
  page: Page,
  productCategory: string,
  fromToDateDdMmYyyy: string
): Promise<ParsedActiveTenderRow[]> {
  await page.click('text=Search Active Tenders');
  await page.waitForSelector('#ProductCategory');
  await page.selectOption('#ProductCategory', { label: productCategory });
  await page.selectOption('#dateCriteria', { label: 'Published Date' });
  await page.evaluate((date) => {
    const from = document.getElementById('fromDate') as HTMLInputElement | null;
    const to = document.getElementById('toDate') as HTMLInputElement | null;
    if (from) from.value = date;
    if (to) to.value = date;
  }, fromToDateDdMmYyyy);

  await page.click('#submit');
  await page.waitForLoadState('load').catch(() => {});

  const cellRows = await page.evaluate(() => {
    const headerRow = Array.from(document.querySelectorAll('tr')).find(
      (tr) => tr.innerText.includes('Tender ID') && tr.innerText.includes('Favorite')
    );
    const table = headerRow?.closest('table');
    if (!table) return [] as string[][];
    return Array.from(table.querySelectorAll('tr'))
      .slice(1) // skip the header row
      .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? ''))
      .filter((cells) => cells.length >= 6 && cells[1].trim() !== '');
  });

  return cellRows.map(parseActiveTenderRow).filter((r): r is ParsedActiveTenderRow => r !== null);
}

/**
 * Checks every Favorite checkbox currently on the results page and clicks
 * "Set Open Tender as Favorite" once, submitting all of them as a batch --
 * the real portal's own validation script (checkConformSaveDocuments,
 * captured live 2026-09-21) counts ALL checked boxes in the form, not just
 * one, confirming this is the intended usage rather than a per-row submit.
 * Its only native alert() paths fire when NOTHING is checked, so this never
 * triggers one as long as there's at least one row -- a defensive dialog
 * handler is still registered in case a checkbox click silently fails to
 * register (observed as a real, if rare, failure mode elsewhere in this
 * codebase's live testing).
 */
export async function favoriteAllVisibleRows(page: Page): Promise<number> {
  const checkboxes = page.locator('input[type=checkbox]');
  const count = await checkboxes.count();
  if (count === 0) return 0;

  for (let i = 0; i < count; i += 1) {
    await checkboxes.nth(i).check({ force: true }).catch(() => {});
  }

  const onDialog = (dialog: Dialog) => {
    void dialog.dismiss();
  };
  page.on('dialog', onDialog);
  await page.click('#save');
  await page.waitForLoadState('load').catch(() => {});
  page.off('dialog', onDialog);

  return count;
}
