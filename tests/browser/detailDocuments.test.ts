import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { downloadDetailDocuments, type CaptureDownload } from '../../src/browser/myTendersController.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

// Shaped like the portal's View Tender Information page (see the search
// foundation plan): a left menu, an NIT table, a zip link, and a Work Item
// table, all with stateful links rather than file URLs.
const DETAIL_HTML = `<html><body>
  <a href="/app?page=Downloads">Downloads</a>
  <a href="/app?page=Home">Tenders by Location</a>
  <table><tr><td>Tender ID</td><td>2026_TNPL_1</td></tr></table>
  <table>
    <tr><td>NIT Document</td></tr>
    <tr><td>1</td><td><a href="/app?component=DirectLink_0&sp=nit">Tendernotice_1.pdf</a></td><td>Tender notice</td></tr>
  </table>
  <a href="/app?component=DirectLink_zip&sp=zip">Download as zip file</a>
  <table>
    <tr><td>Work Item Documents</td></tr>
    <tr><td>1</td><td>BOQ</td><td><a href="/app?component=DirectLink_1&sp=boq">BOQ_845450.xls</a></td></tr>
    <tr><td>2</td><td>Drawing</td><td><a href="/app?component=DirectLink_2&sp=captcha">Drawing_1.pdf</a></td></tr>
  </table>
</body></html>`;

const FILES: Record<string, { name: string; type: string; body: string }> = {
  nit: { name: 'Tendernotice_1.pdf', type: 'application/pdf', body: '%PDF-1.4 notice' },
  zip: { name: '2026_TNPL_1.zip', type: 'application/zip', body: 'PK zip' },
  boq: { name: 'BOQ_845450.xls', type: 'application/vnd.ms-excel', body: 'boq sheet' },
};

describe.skipIf(!CHROME_PATH)('downloadDetailDocuments', { timeout: 90_000 }, () => {
  let server: Server;
  let base: string;
  let userDataDir: string;
  let chromeProc: ReturnType<typeof launchChrome>;
  let cdpPort: number;
  const requested: string[] = [];

  beforeEach(async () => {
    requested.length = 0;
    server = http.createServer((req, res) => {
      const sp = new URL(req.url ?? '/', 'http://x').searchParams.get('sp');
      if (sp) requested.push(sp);
      const file = sp ? FILES[sp] : undefined;
      if (file) {
        res.writeHead(200, { 'Content-Type': file.type, 'Content-Disposition': `attachment; filename="${file.name}"` });
        res.end(file.body);
      } else if (sp === 'captcha') {
        // Some portals answer with a CAPTCHA page instead of the file.
        res.end('<html><body>Enter the captcha to download</body></html>');
      } else {
        res.end(DETAIL_HTML);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-docs-test-'));
    cdpPort = 9222 + Math.floor(Math.random() * 5000);
    chromeProc = launchChrome({ userDataDir, cdpPort, startUrl: `${base}/` });
    await waitForCdpReady(cdpPort, 10000);
  }, 30_000);

  afterEach(async () => {
    try { if (chromeProc.pid) process.kill(chromeProc.pid); } catch { /* already exited */ }
    await removeDirWithRetry(userDataDir);
    server.close();
  });

  it('clicks every tender file and the zip, skips menu links, and records a page answer as a failure', async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`${base}/detail`);
    const saveDir = mkdtempSync(join(tmpdir(), 'tenderassist-docs-saved-'));

    // Stands in for the portal host: the click must start a real download.
    const capture: CaptureDownload = async (click) => {
      const [file] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), click()]);
      const filePath = join(saveDir, file.suggestedFilename());
      await file.saveAs(filePath);
      return { filePath, fileName: file.suggestedFilename() };
    };

    const results = await downloadDetailDocuments(page, capture);

    // Individual files first, the zip last; never the menu's "Downloads".
    expect(results.map((r) => r.fileName)).toEqual(['Tendernotice_1.pdf', 'BOQ_845450.xls', 'Drawing_1.pdf', '2026_TNPL_1.zip']);
    expect(requested).not.toContain(null);
    const saved = results.filter((r) => r.filePath);
    expect(saved.map((r) => r.fileName)).toEqual(['Tendernotice_1.pdf', 'BOQ_845450.xls', '2026_TNPL_1.zip']);
    expect(readFileSync(saved[0].filePath!, 'utf8')).toBe('%PDF-1.4 notice');
    expect(results.find((r) => r.fileName === 'Drawing_1.pdf')?.error).toBeTruthy();
    await browser.close();
  });
});
