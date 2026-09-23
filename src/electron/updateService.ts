import { app, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';

// electron-updater ships as CommonJS. Electron's native ESM loader exposes
// that package through its default export, not as reliable named exports.
const { autoUpdater } = electronUpdater;

export type UpdateState = 'IDLE' | 'CHECKING' | 'AVAILABLE' | 'DOWNLOADING' | 'READY' | 'CURRENT' | 'ERROR';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  message?: string;
}

let status: UpdateStatus = { state: 'IDLE', currentVersion: app.getVersion() };
let configured = false;

function setStatus(window: BrowserWindow | undefined, next: UpdateStatus): void {
  status = next;
  if (window && !window.isDestroyed()) window.webContents.send('update-status', status);
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function configureUpdates(getWindow: () => BrowserWindow | undefined): void {
  if (configured) return;
  configured = true;
  // Packaged Windows apps are GUI processes and may inherit a short-lived
  // stdout/stderr pipe from an installer, launcher, or diagnostic command.
  // electron-updater defaults to console logging; a later write to that
  // closed pipe raises EPIPE in the Electron main process. Keep updater
  // diagnostics in the UI status channel instead of writing to console.
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setStatus(getWindow(), { state: 'CHECKING', currentVersion: app.getVersion() }));
  autoUpdater.on('update-available', (info) => setStatus(getWindow(), { state: 'AVAILABLE', currentVersion: app.getVersion(), availableVersion: info.version }));
  autoUpdater.on('download-progress', (progress) => setStatus(getWindow(), {
    state: 'DOWNLOADING', currentVersion: app.getVersion(), progressPercent: Math.round(progress.percent),
  }));
  autoUpdater.on('update-downloaded', (info) => setStatus(getWindow(), {
    state: 'READY', currentVersion: app.getVersion(), availableVersion: info.version,
    message: 'Update downloaded. Restart TenderAssist to install it.',
  }));
  autoUpdater.on('update-not-available', () => setStatus(getWindow(), { state: 'CURRENT', currentVersion: app.getVersion(), message: 'TenderAssist is up to date.' }));
  autoUpdater.on('error', (error) => setStatus(getWindow(), { state: 'ERROR', currentVersion: app.getVersion(), message: error.message }));
}

export async function checkForUpdates(getWindow: () => BrowserWindow | undefined): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    status = { state: 'CURRENT', currentVersion: app.getVersion(), message: 'Update checks run in installed builds.' };
    return status;
  }
  configureUpdates(getWindow);
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setStatus(getWindow(), {
      state: 'ERROR',
      currentVersion: app.getVersion(),
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return status;
}

export function restartToInstall(): void {
  if (status.state !== 'READY') throw new Error('No downloaded update is ready to install.');
  autoUpdater.quitAndInstall(false, true);
}
