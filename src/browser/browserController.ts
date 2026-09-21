/// <reference lib="dom" />
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import { isSessionExpiredPage } from './sessionExpiredDetector.js';

export type SessionLossReason = 'TAB_CLOSED' | 'TARGET_DESTROYED' | 'SESSION_EXPIRED_PAGE';

export interface BrowserControllerOptions {
  cdpEndpoint: string;
  onSessionLost: (reason: SessionLossReason) => void;
}

export class BrowserController {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private targetId: string | undefined;
  private lost = false;

  constructor(private options: BrowserControllerOptions) {}

  async attach(): Promise<{ targetId: string }> {
    this.browser = await chromium.connectOverCDP(this.options.cdpEndpoint);
    const context: BrowserContext = this.browser.contexts()[0] ?? (await this.browser.newContext());
    const existingPages = context.pages();
    this.page = existingPages.length > 0 ? existingPages[0] : await context.newPage();

    const pageCdp: CDPSession = await context.newCDPSession(this.page);
    const targetInfo = await pageCdp.send('Target.getTargetInfo');
    this.targetId = targetInfo.targetInfo.targetId;

    this.page.on('close', () => this.reportLoss('TAB_CLOSED'));
    this.page.on('framenavigated', (frame) => {
      if (frame !== this.page!.mainFrame()) return;
      void this.checkSessionExpired();
    });

    const browserCdp = await this.browser.newBrowserCDPSession();
    // Playwright's CDP session hijacks downloads by default (Browser.setDownloadBehavior
    // 'allowAndName', writing to its own temp dir under a GUID filename with no
    // extension) so it can fire page.on('download') events -- nothing in this
    // codebase listens for those. TN Tenders' DSC login flow depends on a real,
    // correctly-named signData.jnlp landing in the browser's normal downloads so
    // Windows can open it via Java Web Start; without this override the human
    // never gets an openable file. 'default' restores native per-profile behavior.
    await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
    await browserCdp.send('Target.setDiscoverTargets', { discover: true });
    browserCdp.on('Target.targetDestroyed', (event) => {
      if (event.targetId === this.targetId) {
        this.reportLoss('TARGET_DESTROYED');
      }
    });

    return { targetId: this.targetId };
  }

  private async checkSessionExpired(): Promise<void> {
    if (!this.page || this.lost) return;
    const url = this.page.url();
    let text: string;
    try {
      text = await this.page.innerText('body');
    } catch {
      return;
    }
    if (isSessionExpiredPage(url, text)) {
      this.reportLoss('SESSION_EXPIRED_PAGE');
    }
  }

  private reportLoss(reason: SessionLossReason): void {
    if (this.lost) return;
    this.lost = true;
    this.options.onSessionLost(reason);
  }

  /**
   * Marks this controller as done, so a subsequent tab-close/target-destroy
   * event (e.g. a caller deliberately killing Chrome once a job has already
   * reached SUCCESS/TIMEOUT/ABORTED, to free the profile lock for the next
   * job) is not reported as a session loss and doesn't overwrite an
   * already-terminal auth/job state. Reuses the same `lost` guard
   * `reportLoss` already checks, just without invoking the callback.
   */
  dispose(): void {
    this.lost = true;
  }

  getPage(): Page {
    if (!this.page) throw new Error('BrowserController is not attached');
    return this.page;
  }

  getTargetId(): string {
    if (!this.targetId) throw new Error('BrowserController is not attached');
    return this.targetId;
  }

  async navigate(url: string): Promise<void> {
    await this.getPage().goto(url);
  }

  async extractPageText(): Promise<string> {
    // TN Tenders renders some controls -- notably the Logout link -- as an
    // <img title="..."> with no visible text (see logout2.png in the real
    // portal markup), so innerText('body') alone misses them even on a
    // genuinely authenticated page. Appending image title/alt attributes
    // makes those accessible-but-not-visible labels available to detectors
    // like isAuthenticatedDashboard() without changing what they match on.
    return this.getPage().evaluate(() => {
      const imageLabels = Array.from(document.images)
        .map((img) => img.title || img.alt)
        .filter(Boolean);
      return [document.body.innerText, ...imageLabels].join('\n');
    });
  }
}
