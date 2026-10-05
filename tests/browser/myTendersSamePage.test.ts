import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { navigateToMyTenders, reviewTendersFromMyTenders } from '../../src/browser/myTendersController.js';
import type { TenderRow } from '../../src/persistence/repositories/tenderRepository.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

// As seen live on TN Tenders: My Tenders lists favourites on one page, and
// each row's "View Tender Information" link opens the details in the SAME
// page (no pop-up). Every details page carries the portal's menu.
const MENU = '<a href="/my">My Tenders</a> <a href="/search">Search Active Tenders</a>';
const LIST_HTML = `<html><head><meta charset="utf-8"></head><body>${MENU}
  <table>
    <tr><td>S.No</td><td>Tender ID</td><td>Tender Reference Number</td><td>Tender Title</td><td>View</td></tr>
    <tr><td>1</td><td>2026_A_1_1</td><td>REF/A</td><td>Coaching</td><td><a href="/detail?id=A"><img src="images/view.png" title="View Tender Information"></a></td></tr>
    <tr><td>2</td><td>2026_B_2_1</td><td>REF/B</td><td>Web portal</td><td><a href="/detail?id=B"><img src="images/view.png" title="View Tender Information"></a></td></tr>
  </table></body></html>`;
const detailHtml = (id: string, text: string) => `<html><head><meta charset="utf-8"></head><body>${MENU}
  <table><tr><td>Tender ID</td><td>2026_${id}_${id === 'A' ? 1 : 2}_1</td></tr><tr><td>Work Description</td><td>${text}</td></tr></table>
</body></html>`;

const tender = (id: string, portalId: string, ref: string): TenderRow => ({
  id, job_id: 'job', tender_ref: ref, tender_portal_id: portalId, title: id, organisation_chain: null,
  published_date: null, closing_date: null, opening_date: null, product_category: 'Services', value_in_rupees: 'NA',
  favorited: 1, favorited_at: null, detail_product_category: null, tender_category: null, detail_text: null,
  detail_reviewed_at: null, document_links_json: '[]', created_at: '', updated_at: '',
}) as TenderRow;

describe.skipIf(!CHROME_PATH)('My Tenders with details in the same page', { timeout: 60_000 }, () => {
  let server: Server;
  let base: string;
  let userDataDir: string;
  let chromeProc: ReturnType<typeof launchChrome>;
  let cdpPort: number;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/detail') res.end(detailHtml(url.searchParams.get('id') ?? '', url.searchParams.get('id') === 'B' ? 'web application development' : 'coaching classes'));
      else res.end(LIST_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-mytenders-test-'));
    cdpPort = 9222 + Math.floor(Math.random() * 5000);
    chromeProc = launchChrome({ userDataDir, cdpPort, startUrl: `${base}/` });
    await waitForCdpReady(cdpPort, 10000);
  }, 30_000);

  afterEach(async () => {
    try { if (chromeProc.pid) process.kill(chromeProc.pid); } catch { /* already exited */ }
    await removeDirWithRetry(userDataDir);
    server.close();
  });

  it('opens every favourite, returning to the list through the My Tenders link', async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`${base}/search`);
    await navigateToMyTenders(page);
    const seen: string[] = [];

    const batch = await reviewTendersFromMyTenders(
      page,
      [tender('a', '2026_A_1_1', 'REF/A'), tender('b', '2026_B_2_1', 'REF/B')],
      100,
      undefined,
      async (row, details) => { seen.push(`${row.id}:${details.bodyText.includes('web application') ? 'web' : 'other'}`); }
    );

    expect(batch.errors.size).toBe(0);
    expect(seen).toEqual(['a:other', 'b:web']);
    expect(page.url()).toBe(`${base}/my`);
    await browser.close();
  });
});
