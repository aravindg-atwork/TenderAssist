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
    return this.getPage().innerText('body');
  }
}
