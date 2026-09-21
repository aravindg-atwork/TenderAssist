import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { BrowserController, type SessionLossReason } from '../../src/browser/browserController.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!CHROME_PATH)('BrowserController', { timeout: 30_000 }, () => {
  let server: Server;
  let serverPort: number;
  let userDataDir: string;
  let chromeProc: ReturnType<typeof launchChrome>;
  let cdpPort: number;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.includes('page=CommonErrorPage')) {
        res.end('<html><body>Your session in the client area has expired.</body></html>');
      } else if (req.url?.includes('/dashboard-image-logout')) {
        // Matches the real TN Tenders markup exactly: the Logout control is
        // an <img title="Logout"> with no alt attribute, not visible text, so
        // innerText('body') alone never contains the word "Logout" even on a
        // genuinely authenticated page. See extractPageText()'s comment.
        // Checked before the plain '/dashboard' branch below, since that
        // substring-matches this URL too.
        res.end(
          '<html><body>Welcome : test@example.com<br>Bid Management<br>' +
            '<a href="/logout"><img src="logout.png" title="Logout"></a></body></html>'
        );
      } else if (req.url?.includes('/dashboard')) {
        res.end('<html><body>Welcome : test@example.com<br>Bid Management<br>Logout</body></html>');
      } else if (req.url?.includes('logout.png')) {
        // A real 1x1 transparent PNG -- the image must actually load, or
        // Chrome renders alt/title text as a broken-image fallback, which
        // would make the test pass for the wrong reason (that fallback
        // rendering doesn't happen on the real portal, where the icon loads).
        const onePixelPng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64'
        );
        res.setHeader('Content-Type', 'image/png');
        res.end(onePixelPng);
      } else {
        res.end('<html><body>hello</body></html>');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as { port: number }).port;

    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-bc-test-'));
    cdpPort = 9222 + Math.floor(Math.random() * 5000);
    chromeProc = launchChrome({ userDataDir, cdpPort });
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

  it('attaches, retains a single page, and returns its CDP targetId', async () => {
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: () => {},
    });

    const { targetId } = await controller.attach();
    expect(typeof targetId).toBe('string');
    expect(targetId.length).toBeGreaterThan(0);
    expect(controller.getTargetId()).toBe(targetId);
  });

  it('navigates and extracts page text', async () => {
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: () => {},
    });
    await controller.attach();

    await controller.navigate(`http://127.0.0.1:${serverPort}/dashboard`);
    const text = await controller.extractPageText();

    expect(text).toContain('Welcome : test@example.com');
    expect(text).toContain('Bid Management');
    expect(text).toContain('Logout');
  });

  it('extracts image title/alt text, not just visible innerText', async () => {
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: () => {},
    });
    await controller.attach();

    await controller.navigate(`http://127.0.0.1:${serverPort}/dashboard-image-logout`);
    const text = await controller.extractPageText();

    expect(text).toContain('Welcome : test@example.com');
    expect(text).toContain('Bid Management');
    expect(text).toContain('Logout');
  });

  it('reports TAB_CLOSED when the retained page is closed', async () => {
    const losses: SessionLossReason[] = [];
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: (reason) => losses.push(reason),
    });
    await controller.attach();

    await controller.getPage().close();
    await waitFor(() => losses.includes('TAB_CLOSED'));

    expect(losses).toContain('TAB_CLOSED');
  });

  it('dispose() suppresses a subsequent tab-close from being reported as a loss', async () => {
    const losses: SessionLossReason[] = [];
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: (reason) => losses.push(reason),
    });
    await controller.attach();

    controller.dispose();
    await controller.getPage().close();
    // Give the close event a moment to have been handled, if it were going
    // to fire the callback at all -- there's no terminal state to wait for
    // here since the whole point is that nothing should be reported.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(losses).toEqual([]);
  });

  it('reports SESSION_EXPIRED_PAGE when navigation lands on a session-expired page', async () => {
    const losses: SessionLossReason[] = [];
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: (reason) => losses.push(reason),
    });
    await controller.attach();

    await controller.navigate(`http://127.0.0.1:${serverPort}/nicgep/app?page=CommonErrorPage`);
    await waitFor(() => losses.includes('SESSION_EXPIRED_PAGE'));

    expect(losses).toContain('SESSION_EXPIRED_PAGE');
  });

  it('throws from getPage/getTargetId when not yet attached', () => {
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: () => {},
    });
    expect(() => controller.getPage()).toThrow('not attached');
    expect(() => controller.getTargetId()).toThrow('not attached');
  });
});
