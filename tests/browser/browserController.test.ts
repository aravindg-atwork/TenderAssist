import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { BrowserController, type SessionLossReason } from '../../src/browser/browserController.js';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

describe.skipIf(!existsSync(CHROME_PATH))('BrowserController', () => {
  let server: Server;
  let serverPort: number;
  let userDataDir: string;
  let chromeProc: ReturnType<typeof launchChrome>;
  let cdpPort: number;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.includes('page=CommonErrorPage')) {
        res.end('<html><body>Your session in the client area has expired.</body></html>');
      } else if (req.url?.includes('/dashboard')) {
        res.end('<html><body>Welcome : test@example.com<br>Bid Management<br>Logout</body></html>');
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
  });

  afterEach(() => {
    if (chromeProc.pid) {
      try {
        process.kill(chromeProc.pid);
      } catch {
        // already exited
      }
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold a transient handle lock on the profile dir for
      // up to ~1s after the Chrome process is killed (verified: kill
      // itself is always clean, no orphaned process, this is filesystem
      // handle-release lag, not a leak) — verified during Task 1's review.
    }
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

  it('reports TAB_CLOSED when the retained page is closed', async () => {
    const losses: SessionLossReason[] = [];
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: (reason) => losses.push(reason),
    });
    await controller.attach();

    await controller.getPage().close();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(losses).toContain('TAB_CLOSED');
  });

  it('reports SESSION_EXPIRED_PAGE when navigation lands on a session-expired page', async () => {
    const losses: SessionLossReason[] = [];
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: (reason) => losses.push(reason),
    });
    await controller.attach();

    await controller.navigate(`http://127.0.0.1:${serverPort}/nicgep/app?page=CommonErrorPage`);
    await new Promise((resolve) => setTimeout(resolve, 300));

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
