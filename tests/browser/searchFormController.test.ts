import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { searchCategory, favoriteAllVisibleRows } from '../../src/browser/searchFormController.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

// Reproduces the real search-form page and results table, captured live
// 2026-09-21 against an authenticated session (see the design spec).
const SEARCH_FORM_HTML = `<html><body>
  <a href="/">Search Active Tenders</a>
  <select id="ProductCategory">
    <option value="">-Select-</option>
    <option>Information Technology</option>
    <option>Computer- S/W</option>
  </select>
  <select id="dateCriteria">
    <option value="0">-Select-</option>
    <option value="1">Published Date</option>
  </select>
  <input type="text" name="fromDate" id="fromDate" readonly value="">
  <input type="text" name="toDate" id="toDate" readonly value="">
  <input type="submit" id="submit" value="Search" onclick="document.location.href='/results?category=' + document.getElementById('ProductCategory').value">
</body></html>`;

function resultsHtml(rows: Array<{ id: string; title: string; ref: string; category: string; value: string }>): string {
  const rowsHtml = rows
    .map(
      (r, i) => `<tr>
        <td>${i + 1}.</td>
        <td>${r.id}</td>
        <td>${r.title}</td>
        <td>${r.ref}</td>
        <td>${r.category}</td>
        <td>${r.value}</td>
        <td><input type="checkbox" name="Checkbox" id="Checkbox"></td>
      </tr>`
    )
    .join('');
  return `<html><body>
    <a href="/">Search Active Tenders</a>
    <form id="activeTenders" action="/favorited" method="post">
      <table>
        <tr><td>S.No</td><td>Tender ID</td><td>Tender Title</td><td>Tender Reference Number</td><td>Product Category</td><td>Value in Rs</td><td>Favorite</td></tr>
        ${rowsHtml}
        <tr><td colspan="7">&nbsp;</td></tr>
      </table>
      <script>
        function checkConformSaveDocuments(f1, cname) {
          var f = document.getElementById(f1);
          var countf = 0, counti = 0;
          for (var i = 0; i < f.elements.length; i++) {
            if (f.elements[i].type === 'checkbox') {
              counti++;
              if (f.elements[i].checked) countf++;
            }
          }
          if (countf <= 0 && counti > 0) { alert('Please select atleast one ' + cname); return false; }
          if (countf <= 0 && counti <= 0) { alert('No documents available'); return false; }
          return true;
        }
      </script>
      <input type="submit" id="save" value="Set Open Tender as Favorite" onclick="return checkConformSaveDocuments('activeTenders','tender');">
    </form>
  </body></html>`;
}

describe.skipIf(!CHROME_PATH)('searchFormController', { timeout: 30_000 }, () => {
  let server: Server;
  let serverPort: number;
  let userDataDir: string;
  let chromeProc: ReturnType<typeof launchChrome>;
  let cdpPort: number;
  let currentRows: Array<{ id: string; title: string; ref: string; category: string; value: string }> = [];

  beforeEach(async () => {
    currentRows = [];
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/results')) {
        res.end(resultsHtml(currentRows));
      } else if (req.url?.startsWith('/favorited')) {
        res.end('<html><body>Favorited. <a href="/">Search Active Tenders</a></body></html>');
      } else {
        res.end(SEARCH_FORM_HTML);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as { port: number }).port;

    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-searchform-test-'));
    cdpPort = 9222 + Math.floor(Math.random() * 5000);
    chromeProc = launchChrome({ userDataDir, cdpPort, startUrl: `http://127.0.0.1:${serverPort}/` });
    await waitForCdpReady(cdpPort, 10000);
  }, 30_000);

  afterEach(async () => {
    if (chromeProc.pid) {
      try {
        process.kill(chromeProc.pid);
      } catch {
        // already exited
      }
    }
    await removeDirWithRetry(userDataDir);
    server.close();
  });

  it('searchCategory selects the category, submits, and parses every result row', async () => {
    currentRows = [
      { id: '2026_EB_705493_1', title: 'AMC for Energy Software', ref: 'CE/IT-11/2026-27', category: 'Information Technology', value: 'NA' },
    ];
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/`);

    const rows = await searchCategory(page, 'Information Technology', '21/09/2026');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      serialNo: '1.',
      tenderId: '2026_EB_705493_1',
      title: 'AMC for Energy Software',
      referenceNumber: 'CE/IT-11/2026-27',
      productCategory: 'Information Technology',
      valueInRupees: 'NA',
    });
  });

  it('searchCategory returns an empty array when there are zero results', async () => {
    currentRows = [];
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/`);

    const rows = await searchCategory(page, 'Information Technology', '21/09/2026');

    expect(rows).toEqual([]);
  });

  it('favoriteAllVisibleRows checks every row and submits without a validation alert', async () => {
    currentRows = [
      { id: 'id-1', title: 't1', ref: 'ref-1', category: 'Information Technology', value: 'NA' },
      { id: 'id-2', title: 't2', ref: 'ref-2', category: 'Information Technology', value: 'NA' },
    ];
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/results`);

    let dialogSeen = false;
    page.on('dialog', () => {
      dialogSeen = true;
    });

    const count = await favoriteAllVisibleRows(page);

    expect(count).toBe(2);
    expect(dialogSeen).toBe(false);
    expect(page.url()).toContain('/favorited');
  });

  it('favoriteAllVisibleRows returns 0 and does not submit when there are no rows', async () => {
    currentRows = [];
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/results`);

    const count = await favoriteAllVisibleRows(page);

    expect(count).toBe(0);
    expect(page.url()).not.toContain('/favorited');
  });
});
