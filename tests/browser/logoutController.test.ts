import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { attemptLogout } from '../../src/browser/logoutController.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

describe.skipIf(!CHROME_PATH)('attemptLogout', { timeout: 30_000 }, () => {
  let server: Server;
  let serverPort: number;
  let userDataDir: string;
  let chromeProc: ReturnType<typeof launchChrome>;
  let cdpPort: number;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.includes('/logged-out')) {
        res.end('<html><body>You have been logged out.</body></html>');
      } else {
        // Matches the real portal's Logout control markup, captured live:
        // an <img title="Logout"> inside <a id="logoutLink">.
        res.end('<html><body><a id="logoutLink" href="/logged-out"><img title="Logout"></a></body></html>');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as { port: number }).port;

    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-logout-test-'));
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

  it('clicks the real Logout link and lands on the resulting page', async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/`);

    await attemptLogout(page);

    expect(page.url()).toContain('/logged-out');
  });

  it('resolves without throwing when the page is already closed', async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.close();

    await expect(attemptLogout(page)).resolves.toBeUndefined();
  });

  it('resolves without throwing when the Logout link never appears (bounded timeout)', async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/logged-out`); // no #logoutLink on this page

    await expect(attemptLogout(page, 500)).resolves.toBeUndefined();
  });
});
