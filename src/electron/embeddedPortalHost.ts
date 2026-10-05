import { app, BrowserWindow, WebContentsView, session, type Rectangle } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  finalizeDscDownload,
  isTrustedDscDownload,
  type DscDownloadCandidate,
  type DscJnlpArtifact,
} from '../browser/dscDownloadSecurity.js';
import { portalAllowedHosts, portalTargetPrefix, type PortalDefinition } from '../config/portalRegistry.js';

function isTrustedPortalUrl(rawUrl: string, portal: PortalDefinition): boolean {
  try {
    const url = new URL(rawUrl);
    const hosts = new Set(portalAllowedHosts(portal));
    const rootPath = new URL(portal.url).pathname.replace(/\/app\/?$/i, '');
    return url.protocol === 'https:' && hosts.has(url.hostname.toLocaleLowerCase()) && url.pathname.startsWith(`${rootPath}/`);
  } catch {
    return false;
  }
}

// A portal page that stops responding for this long is treated as crashed.
const UNRESPONSIVE_LIMIT_MS = 20_000;
// Health check: the page must answer a trivial script this often...
const HEALTH_CHECK_INTERVAL_MS = 15_000;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;
// ...and is treated as dead after this many misses in a row (about a minute).
const HEALTH_CHECK_MISSES = 4;
// Automatic reloads after a page fails to load, before leaving it to the operator.
const MAX_LOAD_RETRIES = 3;

export class EmbeddedPortalHost {
  private view: WebContentsView | undefined;
  private crashed = false;
  private readonly crashListeners = new Set<(reason: string) => void>();
  private visible = false;
  private bounds: Rectangle = { x: 0, y: 0, width: 1, height: 1 };
  private zoomFactor = 1;
  private readonly dscListeners = new Set<(artifact: DscJnlpArtifact) => void>();
  private readonly portalSession: Electron.Session;
  private readonly partition: string;

  constructor(
    private readonly windowProvider: () => BrowserWindow | undefined,
    private readonly dscDownloadDirectory: string,
    private readonly portal: PortalDefinition
  ) {
    this.partition = `persist:tenderassist-${portal.id.replace(/[^a-z0-9-]/gi, '-')}`;
    this.portalSession = session.fromPartition(this.partition, { cache: true });
    mkdirSync(dscDownloadDirectory, { recursive: true });
    this.configureSession();
  }

  async open(url: string): Promise<void> {
    if (!isTrustedPortalUrl(url, this.portal)) throw new Error('TenderAssist blocked an untrusted portal URL.');
    this.close();

    const window = this.windowProvider();
    if (!window || window.isDestroyed()) throw new Error('The TenderAssist window is not available.');

    const view = new WebContentsView({
      webPreferences: {
        partition: this.partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: !app.isPackaged,
      },
    });
    this.view = view;
    this.crashed = false;
    view.setBounds(this.bounds);
    view.setVisible(this.visible);
    window.contentView.addChildView(view);
    view.webContents.setZoomFactor(this.zoomFactor);
    // Chromium can reset zoom when a navigation crosses origins; reapply so the
    // operator's chosen size survives every portal page.
    view.webContents.on('did-navigate', () => {
      if (!view.webContents.isDestroyed()) view.webContents.setZoomFactor(this.zoomFactor);
    });

    view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (isTrustedPortalUrl(targetUrl, this.portal)) {
        queueMicrotask(() => {
          if (this.view === view && !view.webContents.isDestroyed()) {
            void view.webContents.loadURL(targetUrl).catch(() => {});
          }
        });
      }
      return { action: 'deny' };
    });

    view.webContents.on('will-navigate', (event, targetUrl) => {
      if (!isTrustedPortalUrl(targetUrl, this.portal)) event.preventDefault();
    });

    view.webContents.on('render-process-gone', (_event, details) => {
      if (this.view !== view || details.reason === 'clean-exit') return;
      this.crashed = true;
      for (const listener of this.crashListeners) listener(details.reason);
    });
    // A hung page is ended so it can be reopened instead of freezing the run.
    let unresponsiveTimer: NodeJS.Timeout | undefined;
    view.webContents.on('unresponsive', () => {
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = setTimeout(() => {
        if (this.view === view && !view.webContents.isDestroyed()) view.webContents.forcefullyCrashRenderer();
      }, UNRESPONSIVE_LIMIT_MS);
    });
    view.webContents.on('responsive', () => clearTimeout(unresponsiveTimer));

    // A dead page that is neither crashed nor reported unresponsive (blank,
    // frozen) is found by checking that it still runs a trivial script.
    let misses = 0;
    let checking = false;
    const healthTimer = setInterval(() => {
      if (checking || this.view !== view || this.crashed || view.webContents.isDestroyed()) return;
      checking = true;
      let timeout: NodeJS.Timeout | undefined;
      const answered = Promise.race([
        view.webContents.executeJavaScript('1', true).then(() => true, () => false),
        new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), HEALTH_CHECK_TIMEOUT_MS); }),
      ]);
      void answered.then((ok) => {
        clearTimeout(timeout);
        checking = false;
        misses = ok ? 0 : misses + 1;
        if (misses >= HEALTH_CHECK_MISSES && this.view === view && !this.crashed) {
          this.crashed = true;
          for (const listener of this.crashListeners) listener('not responding');
        }
      });
    }, HEALTH_CHECK_INTERVAL_MS);

    // A page that fails to load (network blip, portal timeout) is reloaded,
    // a few times, instead of leaving an error page behind.
    let loadRetries = 0;
    view.webContents.on('did-finish-load', () => { loadRetries = 0; });
    view.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      // -3 is an aborted load, such as a navigation replaced by another.
      if (!isMainFrame || errorCode === -3 || this.view !== view || loadRetries >= MAX_LOAD_RETRIES) return;
      loadRetries += 1;
      setTimeout(() => {
        if (this.view === view && !view.webContents.isDestroyed()) view.webContents.reload();
      }, 2_000 * loadRetries);
    });

    view.webContents.once('destroyed', () => {
      clearTimeout(unresponsiveTimer);
      clearInterval(healthTimer);
    });

    await view.webContents.loadURL(url);
  }

  close(): void {
    const view = this.view;
    this.view = undefined;
    if (!view) return;
    const window = this.windowProvider();
    if (window && !window.isDestroyed()) window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.view?.setVisible(visible);
  }

  setBounds(bounds: Rectangle): void {
    const window = this.windowProvider();
    if (!window || window.isDestroyed()) return;
    const content = window.getContentBounds();
    const x = Math.max(0, Math.min(Math.round(bounds.x), content.width - 1));
    const y = Math.max(0, Math.min(Math.round(bounds.y), content.height - 1));
    const width = Math.max(1, Math.min(Math.round(bounds.width), content.width - x));
    const height = Math.max(1, Math.min(Math.round(bounds.height), content.height - y));
    this.bounds = { x, y, width, height };
    this.view?.setBounds(this.bounds);
  }

  /** False once the page has crashed: it must be opened again, not reused. */
  get isOpen(): boolean {
    return Boolean(this.view && !this.view.webContents.isDestroyed() && !this.crashed);
  }

  /** Called when the portal page crashes or hangs, with the reason. */
  onCrashed(listener: (reason: string) => void): () => void {
    this.crashListeners.add(listener);
    return () => this.crashListeners.delete(listener);
  }

  get portalId(): string {
    return this.portal.id;
  }

  /** Zoom only the portal page; the view is never reloaded or recreated. */
  setZoomPercent(percent: number): void {
    this.zoomFactor = percent / 100;
    const contents = this.view?.webContents;
    if (contents && !contents.isDestroyed()) contents.setZoomFactor(this.zoomFactor);
  }

  goBack(): void {
    const contents = this.view?.webContents;
    if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
  }

  reload(): void {
    this.view?.webContents.reload();
  }

  onDscReady(listener: (artifact: DscJnlpArtifact) => void): () => void {
    this.dscListeners.add(listener);
    return () => this.dscListeners.delete(listener);
  }

  private configureSession(): void {
    this.portalSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    this.portalSession.setPermissionCheckHandler(() => false);

    this.portalSession.on('will-download', (_event, item, webContents) => {
      if (webContents !== this.view?.webContents) return;
      const candidate: DscDownloadCandidate = {
        sourceUrl: item.getURL(),
        suggestedFilename: item.getFilename(),
      };
      const hosts = portalAllowedHosts(this.portal);
      const pathPrefix = `${new URL(this.portal.url).pathname.replace(/\/app\/?$/i, '')}/`;
      if (!isTrustedDscDownload(candidate, hosts, pathPrefix)) return;

      const temporaryPath = join(this.dscDownloadDirectory, `${randomUUID()}.download`);
      item.setSavePath(temporaryPath);
      item.once('done', (_doneEvent, state) => {
        if (state !== 'completed') return;
        try {
          const artifact = finalizeDscDownload(temporaryPath, this.dscDownloadDirectory, candidate, hosts, pathPrefix);
          if (artifact) {
            for (const listener of this.dscListeners) listener(artifact);
          }
        } catch {
          // Invalid or incomplete signer downloads remain inert and are never
          // offered to the operating system for execution.
        }
      });
    });
  }
}

export const embeddedPortalTargetPrefix = portalTargetPrefix;
