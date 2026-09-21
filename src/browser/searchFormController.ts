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
    // The real portal is a deeply nested-table page layout: an ANCESTOR <tr>
    // (part of the outer page chrome) can also satisfy the text check below,
    // since a <tr>'s innerText is a superset of everything nested inside it,
    // including the real results table many levels down. document.querySelectorAll
    // returns elements in document (pre-order) order, so a naive .find() on
    // the first matching <tr>/<table> grabs that outer ancestor, not the real
    // header row -- confirmed live: this produced whole-page header/nav text
    // (e.g. "Welcome : ...") as "tender data" instead of real rows. Picking
    // the SMALLEST matching table (by outerHTML length) reliably selects the
    // innermost, real one instead -- the same technique used when the real
    // Search Active Tenders markup was originally captured for this plan.
    const candidateTables = Array.from(document.querySelectorAll('table')).filter(
      (t) => t.innerText.includes('Tender ID') && t.innerText.includes('Favorite')
    );
    candidateTables.sort((a, b) => a.outerHTML.length - b.outerHTML.length);
    const table = candidateTables[0];
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
  const total = await checkboxes.count();
  if (total === 0) return 0;

  // count() alone would overstate success if a check() below silently
  // failed to register (the same class of flaky click this codebase has
  // hit before -- and every row's checkbox shares the same real portal
  // id/name, "Checkbox", confirmed live, which makes a single-attempt
  // check() measurably less reliable). Verify actual checked state, and
  // retry up to 3 times per checkbox before giving up on it -- the same
  // "a click can silently fail to register, retry 2-3 times before
  // concluding failure" policy this plan's own spec already states for
  // every other real-portal click, just not previously applied here.
  let checkedCount = 0;
  for (let i = 0; i < total; i += 1) {
    const checkbox = checkboxes.nth(i);
    let isChecked = false;
    for (let attempt = 0; attempt < 3 && !isChecked; attempt += 1) {
      await checkbox.check({ force: true }).catch(() => {});
      isChecked = await checkbox.isChecked().catch(() => false);
    }
    if (isChecked) checkedCount += 1;
  }
  if (checkedCount === 0) return 0;

  const onDialog = (dialog: Dialog) => {
    void dialog.dismiss();
  };
  page.on('dialog', onDialog);
  await page.click('#save');
  await page.waitForLoadState('load').catch(() => {});
  page.off('dialog', onDialog);

  return checkedCount;
}
