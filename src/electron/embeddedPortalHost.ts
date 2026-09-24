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

export class EmbeddedPortalHost {
  private view: WebContentsView | undefined;
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

  get isOpen(): boolean {
    return Boolean(this.view && !this.view.webContents.isDestroyed());
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
