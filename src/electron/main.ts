// src/electron/main.ts
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, type MenuItemConstructorOptions } from 'electron';
import { join, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir, arch, release } from 'node:os';
import { createDatabase, withTransaction } from '../persistence/db.js';
import { runMigrations } from '../persistence/migrate.js';
import { JobRepository } from '../persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../persistence/repositories/stateTransitionRepository.js';
import { SearchRepository } from '../persistence/repositories/searchRepository.js';
import { TenderRepository, type TenderRow } from '../persistence/repositories/tenderRepository.js';
import { RunConfigurationRepository } from '../persistence/repositories/runConfigurationRepository.js';
import { ClassificationRepository } from '../persistence/repositories/classificationRepository.js';
import { PortalCredentialRepository } from '../persistence/repositories/portalCredentialRepository.js';
import { PublishingSettingsRepository, type PublishingSettings } from '../persistence/repositories/publishingSettingsRepository.js';
import { AutomationSettingsRepository } from '../persistence/repositories/automationSettingsRepository.js';
import { DisplaySettingsRepository, type TextSize } from '../persistence/repositories/displaySettingsRepository.js';
import { TenderWorkflowRepository, type ManualTenderDecision } from '../persistence/repositories/tenderWorkflowRepository.js';
import { JobOutputRepository } from '../persistence/repositories/jobOutputRepository.js';
import { OpportunityRepository } from '../persistence/repositories/opportunityRepository.js';
import { applyTenderDecision, linkAllPossibleRetenders, recordCollectedDocuments, syncJobOpportunities } from '../orchestration/opportunitySync.js';
import { automaticDownloadSelection } from '../orchestration/automaticSelection.js';
import { describeSkipped, planDateBatch, type DateBatchPlan } from '../orchestration/dateBatch.js';
import { buildInbox, type InboxView } from '../review/inbox.js';
import { buildTenders, type TendersView } from '../review/tenders.js';
import { describeTimeline, type TimelineEntry } from '../review/timeline.js';
import { collectAuditHistory, writeAuditWorkbook } from '../review/auditHistory.js';
import type { OperatorDecision } from '../state/opportunityLifecycle.js';
import { JobStateMachine } from '../state/jobStateMachine.js';
import { AuthStateMachine } from '../state/authStateMachine.js';
import { getDatabasePath, getAppDataDir } from '../config/paths.js';
import { waitForCdpReady } from '../browser/chromeLauncher.js';
import { runAuthJob } from '../orchestration/authJobRunner.js';
import { runSearchPhase } from '../orchestration/searchPhaseRunner.js';
import { runClassificationPhase } from '../orchestration/classificationPhaseRunner.js';
import { PORTAL_SESSION_EXPIRED_REASON, runPostProcessing } from '../orchestration/postProcessingRunner.js';
import { attemptLogout } from '../browser/logoutController.js';
import { reactToAuthSessionLoss } from '../browser/authJobCoordinator.js';
import type { Page } from 'playwright-core';
import type {
  JobListItem,
  JobDetail,
  RunSettingsState,
  PortalCredentialSettings,
  SavePortalCredentialInput,
  AuthJobUpdate,
  SettingsSection,
} from './ipcTypes.js';
import { normalizeRunConfiguration, type RunConfiguration } from '../config/runConfiguration.js';
import type { PortalCredentials } from '../browser/portalLoginController.js';
import { isValidJnlpFile, type DscJnlpArtifact } from '../browser/dscDownloadSecurity.js';
import { mirrorTenderFolderToDrive, publishJobWorkbook, tenderOutputDirectory } from '../publishing/jobPublisher.js';
import { checkForUpdates, configureUpdates, getUpdateStatus, restartToInstall } from './updateService.js';
import { runPreflight } from '../system/preflight.js';
import { detectJnlpLauncher, MISSING_SIGNER_MESSAGE, OPENWEBSTART_DOWNLOAD_URL } from '../system/jnlpLauncher.js';
import { spawn } from 'node:child_process';
import { applyPendingRestore, createBackup, inspectBackup, stageRestore } from '../system/backup.js';
import { buildSupportBundle } from '../system/supportBundle.js';
import { EmbeddedPortalHost, embeddedPortalTargetPrefix } from './embeddedPortalHost.js';
import { markJobCancelled, USER_CANCELLED_REASON } from '../orchestration/jobCancellation.js';
import { createActionPacer } from '../orchestration/actionPacer.js';
import { DEFAULT_PORTAL_ID, getPortalDefinition, type PortalDefinition } from '../config/portalRegistry.js';
import { describeResumePlan, planResume, prepareForDocumentCollection } from '../orchestration/jobResume.js';
import type { PaceAction } from '../orchestration/actionPacer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMBEDDED_CDP_PORT = 18_000 + Math.floor(Math.random() * 10_000);
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-debugging-port', String(EMBEDDED_CDP_PORT));

// Claim the process lock before opening SQLite. A fast double-click can start
// two Electron main processes concurrently; the losing process must exit
// before it touches the shared WAL/SHM files.
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
// A restore chosen in the previous session is swapped in before SQLite opens
// the database; the replaced database is kept beside it.
const migrationsDir = join(app.getAppPath(), 'src', 'persistence', 'migrations');
let restoredPreviousDatabase: string | null = null;
let restoreStartupError: string | null = null;
try {
  restoredPreviousDatabase = applyPendingRestore(getDatabasePath());
} catch (error) {
  restoreStartupError = error instanceof Error ? error.message : String(error);
}
const db = createDatabase(getDatabasePath());
runMigrations(db, migrationsDir);
const jobs = new JobRepository(db);
const sessions = new AuthSessionRepository(db);
const transitions = new StateTransitionRepository(db);
const searches = new SearchRepository(db);
const tenders = new TenderRepository(db);
const runConfigurations = new RunConfigurationRepository(db);
const classifications = new ClassificationRepository(db);
const portalCredentials = new PortalCredentialRepository(db);
const workflow = new TenderWorkflowRepository(db);
const publishingSettings = new PublishingSettingsRepository(db, join(homedir(), 'Documents', 'TenderAssist'));
const automationSettings = new AutomationSettingsRepository(db);
const displaySettings = new DisplaySettingsRepository(db);
const jobOutputs = new JobOutputRepository(db);
const opportunities = new OpportunityRepository(db);
const opportunitySync = { tenders, classifications, opportunities, workflow };

// Tender records are a view over run data; a failure to update them must
// never fail the run itself, so report and carry on.
function syncOpportunities(label: string, fn: () => void): void {
  try { fn(); } catch (error) { console.error(`[TenderAssist] tender record sync failed (${label}):`, error); }
}
syncOpportunities('expiry sweep', () => opportunities.expireOverdue());
syncOpportunities('retender links', () => linkAllPossibleRetenders(opportunitySync));
const jobMachine = new JobStateMachine(db, jobs, transitions);
const authMachine = new AuthStateMachine(db, sessions, transitions);

let mainWindow: BrowserWindow | undefined;
let portalHost: EmbeddedPortalHost | undefined;
let activeJobId: string | null = null;
let activeJobAbortController: AbortController | undefined;
let activeStopWatchingSessionLoss: (() => void) | undefined;
let activeJobCompletion: Promise<unknown> | undefined;
let lastActiveJobUpdate: AuthJobUpdate | undefined;
// The active run's place in its range of published dates.
let activeSearchDate: string | undefined;
let activeBatch: AuthJobUpdate['batch'];
let activeRunPortalId: string | undefined;
// Resolves the "run other dates?" question: dates to run next, or null to finish.
let pendingMoreDates: ((choice: DateBatchPlan | null) => void) | undefined;
const dscDownloadDirectory = join(getAppDataDir(), 'dsc-downloads');
const dscArtifacts = new Map<string, DscJnlpArtifact>();
// Fresh sign-ins allowed while collecting documents before the run stops.
const MAX_ACQUISITION_SIGN_INS = 3;

function emitJobUpdate(raw: AuthJobUpdate): void {
  const update: AuthJobUpdate = { searchDate: activeSearchDate, batch: activeBatch, ...raw };
  lastActiveJobUpdate = update;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('job-updated', update);
}

async function credentialSettings(portalId: string): Promise<PortalCredentialSettings> {
  const stored = portalCredentials.get(portalId);
  return {
    loginId: stored.loginId,
    hasSavedPassword: Boolean(stored.encryptedPasswordBase64),
    encryptionAvailable: await safeStorage.isAsyncEncryptionAvailable(),
  };
}

async function loadPortalCredentials(portalId: string): Promise<PortalCredentials | undefined> {
  const stored = portalCredentials.get(portalId);
  if (!stored.loginId || !stored.encryptedPasswordBase64) return undefined;
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('Secure password storage is unavailable on this computer. Complete login manually in the embedded portal.');
  }
  const encrypted = Buffer.from(stored.encryptedPasswordBase64, 'base64');
  const decrypted = await safeStorage.decryptStringAsync(encrypted);
  if (decrypted.shouldReEncrypt) {
    const refreshed = await safeStorage.encryptStringAsync(decrypted.result);
    portalCredentials.save({ loginId: stored.loginId, encryptedPasswordBase64: refreshed.toString('base64') }, portalId);
  }
  return { loginId: stored.loginId, password: decrypted.result };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 900,
    minHeight: 620,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.on('closed', () => {
    portalHost?.close();
    portalHost = undefined;
    mainWindow = undefined;
  });
  void mainWindow.loadFile(join(__dirname, '..', '..', 'renderer', 'dist', 'index.html'));
}

function navigateApplication(view: 'inbox' | 'tenders' | 'jobs' | 'settings', section?: SettingsSection): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('app-navigate', { view, section });
}

async function exportAuditHistory(): Promise<void> {
  const stamp = new Date().toLocaleDateString('en-CA');
  const options: Electron.SaveDialogOptions = {
    title: 'Export audit history',
    defaultPath: join(app.getPath('documents'), `TenderAssist audit history ${stamp}.xlsx`),
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
  };
  const choice = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) return;
  try {
    const entries = collectAuditHistory(db);
    await writeAuditWorkbook(entries, choice.filePath);
    shell.showItemInFolder(choice.filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A workbook left open in Excel is the usual cause.
    dialog.showErrorBox('Audit history not exported', `${message}

If the file is open in Excel, close it and try again.`);
  }
}

async function showMessage(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options);
}

async function backUpData(): Promise<void> {
  const stamp = new Date().toLocaleDateString('en-CA');
  const options: Electron.SaveDialogOptions = {
    title: 'Back up TenderAssist data',
    defaultPath: join(app.getPath('documents'), `TenderAssist backup ${stamp}.db`),
    filters: [{ name: 'TenderAssist backup', extensions: ['db'] }],
  };
  const choice = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) return;
  try {
    createBackup(db, choice.filePath);
    await showMessage({
      type: 'info',
      title: 'Backup saved',
      message: 'Your runs, tenders, decisions, and settings were backed up.',
      detail: `${choice.filePath}\n\nSaved portal passwords are not included. Tender documents stay in your output folder and are not part of this file.`,
    });
    shell.showItemInFolder(choice.filePath);
  } catch (error) {
    dialog.showErrorBox('Backup not saved', error instanceof Error ? error.message : String(error));
  }
}

async function restoreData(): Promise<void> {
  if (activeJobId) {
    dialog.showErrorBox('Restore not started', 'Stop the running job before restoring a backup.');
    return;
  }
  const options: Electron.OpenDialogOptions = {
    title: 'Restore TenderAssist data',
    defaultPath: app.getPath('documents'),
    filters: [{ name: 'TenderAssist backup', extensions: ['db'] }],
    properties: ['openFile'],
  };
  const choice = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  const backupPath = choice.filePaths[0];
  if (choice.canceled || !backupPath) return;
  try {
    const summary = inspectBackup(backupPath, migrationsDir);
    const lastChanged = summary.lastChangedAt ? new Date(summary.lastChangedAt).toLocaleString() : 'no runs yet';
    const answer = await showMessage({
      type: 'warning',
      title: 'Restore backup?',
      message: 'Replace your current TenderAssist data with this backup?',
      detail: `The backup has ${summary.jobCount} runs and ${summary.tenderCount} tenders (last run: ${lastChanged}).\n\nTenderAssist will restart. Your current data is kept as a separate file, not deleted. You will need to enter saved portal passwords again.`,
      buttons: ['Restore and restart', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (answer.response !== 0) return;
    stageRestore(backupPath, getDatabasePath());
    portalHost?.close();
    db.close();
    app.relaunch();
    app.exit(0);
  } catch (error) {
    dialog.showErrorBox('Restore not started', error instanceof Error ? error.message : String(error));
  }
}

async function exportSupportBundle(): Promise<void> {
  const stamp = new Date().toLocaleDateString('en-CA');
  const options: Electron.SaveDialogOptions = {
    title: 'Export support bundle',
    defaultPath: join(app.getPath('documents'), `TenderAssist support ${stamp}.json`),
    filters: [{ name: 'Support bundle', extensions: ['json'] }],
  };
  const choice = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) return;
  try {
    const portal = getPortalDefinition(DEFAULT_PORTAL_ID);
    const output = publishingSettings.get(portal.id);
    const preflight = await runPreflight(output.localOutputRoot, portal.url, portal.name, output.driveOutputRoot).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    const bundle = buildSupportBundle(db, {
      generatedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      environment: {
        packaged: app.isPackaged,
        platform: process.platform,
        osRelease: release(),
        arch: arch(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        activeJob: activeJobId !== null,
      },
      preflight,
    });
    writeFileSync(choice.filePath, JSON.stringify(bundle, null, 2), 'utf8');
    await showMessage({
      type: 'info',
      title: 'Support bundle saved',
      message: 'The support bundle is ready to send.',
      detail: `${choice.filePath}\n\nIt lists recent runs, their states, and your settings. Portal login IDs, passwords, and tender documents are not included.`,
    });
    shell.showItemInFolder(choice.filePath);
  } catch (error) {
    dialog.showErrorBox('Support bundle not saved', error instanceof Error ? error.message : String(error));
  }
}

function reportRestoreOutcome(): void {
  if (restoreStartupError) {
    dialog.showErrorBox('Backup not restored', `TenderAssist opened your existing data instead.\n\n${restoreStartupError}`);
  } else if (restoredPreviousDatabase) {
    void showMessage({
      type: 'info',
      title: 'Backup restored',
      message: 'Your backup has been restored.',
      detail: `Enter saved portal passwords again in Settings before the next run.\n\nThe data you replaced is kept at:\n${restoredPreviousDatabase}`,
    });
  }
}

function configureApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Output folders and naming…', accelerator: 'CmdOrCtrl+Shift+O', click: () => navigateApplication('settings', 'folders') },
        { label: 'Export audit history…', click: () => void exportAuditHistory() },
        { type: 'separator' },
        { label: 'Back up data…', click: () => void backUpData() },
        { label: 'Restore from backup…', click: () => void restoreData() },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => navigateApplication('settings') },
        { type: 'separator' },
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Show Inbox', accelerator: 'CmdOrCtrl+1', click: () => navigateApplication('inbox') },
        { label: 'Show Tenders', accelerator: 'CmdOrCtrl+2', click: () => navigateApplication('tenders') },
        { label: 'Show Runs', accelerator: 'CmdOrCtrl+3', click: () => navigateApplication('jobs') },
        { label: 'Show Settings', accelerator: 'CmdOrCtrl+4', click: () => navigateApplication('settings') },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }] : []),
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for updates…', click: () => void checkForUpdates(() => mainWindow).catch(() => {}) },
        { label: 'Export support bundle…', click: () => void exportSupportBundle() },
        { type: 'separator' },
        {
          label: 'About TenderAssist',
          click: () => {
            const options: Electron.MessageBoxOptions = {
              type: 'info',
              title: 'About TenderAssist',
              message: 'TenderAssist',
              detail: `Version ${app.getVersion()}\nGovernment tender discovery, review, and document organization.`,
            };
            void (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options));
          },
        },
      ],
    },
  ];
  if (process.platform === 'darwin') {
    template.unshift({ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const OPERATOR_DECISIONS: readonly OperatorDecision[] = ['APPROVE', 'REJECT', 'DEFER', 'REOPEN'];

ipcMain.handle('get-inbox', (): InboxView => buildInbox(opportunities));

ipcMain.handle('decide-tenders', (_event, opportunityIds: unknown, decision: unknown, note?: unknown): InboxView => {
  if (!Array.isArray(opportunityIds) || opportunityIds.length === 0 || !opportunityIds.every((id) => typeof id === 'string')) {
    throw new Error('Choose at least one tender.');
  }
  if (!OPERATOR_DECISIONS.includes(decision as OperatorDecision)) throw new Error('Unknown decision.');
  opportunities.decide(opportunityIds, decision as OperatorDecision, { note: typeof note === 'string' ? note : null });
  if (decision === 'APPROVE') afterApproval(approvedTenderRowsFor(opportunityIds));
  return buildInbox(opportunities);
});

ipcMain.handle('acknowledge-tender-changes', (_event, opportunityIds: unknown): InboxView => {
  if (!Array.isArray(opportunityIds) || !opportunityIds.every((id) => typeof id === 'string')) throw new Error('Invalid tenders.');
  opportunities.acknowledgeChanges(opportunityIds);
  return buildInbox(opportunities);
});

ipcMain.handle('dismiss-related-tender', (_event, opportunityId: unknown, otherId: unknown): void => {
  if (typeof opportunityId !== 'string' || typeof otherId !== 'string') throw new Error('Invalid tenders.');
  opportunities.dismissRetenderLink(opportunityId, otherId);
});

ipcMain.handle('acknowledge-runs', (_event, jobIds: unknown): InboxView => {
  if (!Array.isArray(jobIds) || !jobIds.every((id) => typeof id === 'string')) throw new Error('Invalid runs.');
  jobs.markReviewed(jobIds.filter((id) => id !== activeJobId));
  return buildInbox(opportunities);
});

ipcMain.handle('get-tenders', (): TendersView => buildTenders(opportunities));

ipcMain.handle('get-tender-timeline', (_event, opportunityId: unknown): TimelineEntry[] => {
  if (typeof opportunityId !== 'string' || !opportunities.getById(opportunityId)) throw new Error('Tender not found.');
  return describeTimeline(opportunities.listEvents(opportunityId));
});

ipcMain.handle('list-jobs', (): JobListItem[] => {
  return jobs.listAll().map((job) => {
    const session = sessions.getLatestForJob(job.id);
    const config = runConfigurations.getForJob(job.id);
    return {
      jobId: job.id,
      jobState: job.state,
      authState: session?.state ?? null,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      portalId: config?.portalId ?? DEFAULT_PORTAL_ID,
      searchDate: config?.searchDate ?? null,
    };
  });
});

ipcMain.handle('get-run-settings', (): RunSettingsState => ({
  defaults: runConfigurations.getDefaults(),
  configured: runConfigurations.hasSavedDefaults(),
}));

ipcMain.handle('save-run-settings', (_event, defaults): RunSettingsState => ({
  defaults: runConfigurations.saveDefaults(defaults),
  configured: true,
}));

ipcMain.handle('get-portal-credential-settings', async (_event, portalId: string): Promise<PortalCredentialSettings> => {
  return credentialSettings(getPortalDefinition(portalId).id);
});

ipcMain.handle('get-publishing-settings', (_event, portalId: string) => publishingSettings.get(getPortalDefinition(portalId).id));
ipcMain.handle('save-publishing-settings', (_event, portalId: string, settings) => publishingSettings.save(settings, getPortalDefinition(portalId).id));
ipcMain.handle('get-automation-pacing', () => automationSettings.get());
ipcMain.handle('save-automation-pacing', (_event, settings) => automationSettings.save(settings));
ipcMain.handle('select-publishing-folder', async (_event, initialPath?: string): Promise<string | null> => {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose TenderAssist publishing folder', properties: ['openDirectory', 'createDirectory'],
    defaultPath: typeof initialPath === 'string' && initialPath.trim() ? initialPath : publishingSettings.get().localOutputRoot,
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

function publishStoredJob(jobId: string) {
  const config = runConfigurations.getForJob(jobId);
  if (!config) throw new Error('This job has no saved run configuration.');
  const plan = outputPlanFor(jobId, config.portalId);
  const allItems = tenders.listForJob(jobId).map((tender) => ({
    tender,
    automaticDecision: classifications.getFinalForTender(tender.id),
    manualReview: workflow.getReview(tender.id),
    documents: workflow.listDocuments(tender.id),
    requirements: workflow.getRequirements(tender.id),
  }));
  const explicitlyProcessed = allItems.filter((item) => item.requirements || item.documents.length > 0);
  const items = explicitlyProcessed.length > 0
    ? explicitlyProcessed
    : allItems.filter((item) => (item.manualReview?.decision ?? item.automaticDecision) === 'KEEP');
  const numbered = items.map((item) => ({ ...item, serialNumber: jobOutputs.serialNumberFor(plan, item.tender.id) }));
  return publishJobWorkbook(plan.outputRoot, plan.outputDate, jobId, numbered, plan.structure, plan.runNumber);
}

// Jobs published before output plans existed get one from today's settings
// on first use, in the published date's day folder; after that the plan is frozen.
function outputPlanFor(jobId: string, portalId?: string) {
  const config = runConfigurations.getForJob(jobId);
  if (!jobs.getById(jobId) || !config) throw new Error('Job not found.');
  const settings = publishingSettings.get(portalId ?? DEFAULT_PORTAL_ID);
  return jobOutputs.getOrCreatePlan(jobId, settings.localOutputRoot, config.searchDate, settings.structure);
}

ipcMain.handle('get-update-status', () => getUpdateStatus());
ipcMain.handle('check-for-updates', () => checkForUpdates(() => mainWindow));
ipcMain.handle('restart-to-install-update', (): void => restartToInstall());
ipcMain.handle('run-preflight', (_event, portalId: string) => {
  const portal = getPortalDefinition(portalId);
  const settings = publishingSettings.get(portal.id);
  return runPreflight(settings.localOutputRoot, portal.url, portal.name, settings.driveOutputRoot);
});
ipcMain.handle('get-run-history', (_event, portalId: string) => {
  const portal = getPortalDefinition(portalId);
  const recentRunDates = runConfigurations.listRecentRunDates(portal.id, 5);
  if (recentRunDates.length === 0) return { recentRunDates, missedDates: [] };
  const completed = new Set(recentRunDates);
  const earliest = new Date(`${recentRunDates[recentRunDates.length - 1]}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const missedDates: string[] = [];
  for (const cursor = new Date(earliest); cursor <= today && missedDates.length < 31; cursor.setDate(cursor.getDate() + 1)) {
    const value = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    if (!completed.has(value)) missedDates.push(value);
  }
  return { recentRunDates, missedDates };
});
ipcMain.handle('set-portal-bounds', (_event, bounds) => portalHost?.setBounds(bounds));
ipcMain.handle('set-portal-visible', (_event, visible: boolean) => portalHost?.setVisible(visible === true));
ipcMain.handle('portal-go-back', () => portalHost?.goBack());
ipcMain.handle('portal-reload', () => portalHost?.reload());
ipcMain.handle('get-text-size', () => displaySettings.getTextSize());
ipcMain.handle('save-text-size', (_event, textSize: TextSize) => displaySettings.saveTextSize(textSize));
ipcMain.handle('get-portal-zoom', (_event, portalId: string) => displaySettings.getPortalZoom(getPortalDefinition(portalId).id));
ipcMain.handle('set-portal-zoom', (_event, portalId: string, percent: number) => {
  const id = getPortalDefinition(portalId).id;
  const saved = displaySettings.savePortalZoom(id, percent);
  if (portalHost?.portalId === id) portalHost.setZoomPercent(saved);
  return saved;
});

ipcMain.handle('open-job-output', async (_event, jobId: string): Promise<void> => {
  const config = runConfigurations.getForJob(jobId);
  if (!config) throw new Error('This job has no saved output configuration.');
  const folder = outputPlanFor(jobId, config.portalId).jobDirectory;
  if (!existsSync(folder)) await publishStoredJob(jobId);
  const error = await shell.openPath(folder);
  if (error) throw new Error(`Could not open the job folder: ${error}`);
});

ipcMain.handle('save-tender-review', async (_event, tenderId: string, decision: ManualTenderDecision, reason?: string) => {
  if (decision !== 'KEEP' && decision !== 'REJECT') throw new Error('Review decision must be KEEP or REJECT.');
  const tender = db.prepare('SELECT job_id FROM tenders WHERE id = ?').get(tenderId) as { job_id: string } | undefined;
  if (!tender) throw new Error('Tender not found.');
  const review = workflow.saveReview(tenderId, decision, reason);
  const opportunityId = (db.prepare('SELECT opportunity_id FROM tenders WHERE id = ?').get(tenderId) as { opportunity_id: string | null }).opportunity_id;
  syncOpportunities('review', () => applyTenderDecision(opportunitySync, opportunityId, decision === 'KEEP' ? 'APPROVE' : 'REJECT', { jobId: tender.job_id, note: reason }));
  const job = jobs.getById(tender.job_id);
  if (job?.state === 'COMPLETE' || job?.state === 'REPORTING') await publishStoredJob(tender.job_id);
  if (decision === 'KEEP' && opportunityId) afterApproval(tenders.listForOpportunity(opportunityId));
  return review;
});

ipcMain.handle('get-recovery-job', () => {
  const job = jobs.findIncomplete();
  if (!job || job.id === activeJobId) return null;
  const config = runConfigurations.getForJob(job.id);
  if (!config) return null;
  const plan = planResume({ jobState: job.state, selection: runConfigurations.getSelection(job.id) });
  return { jobId: job.id, state: job.state, config, resume: plan.kind, resumeDescription: describeResumePlan(plan) };
});

ipcMain.handle('dismiss-recovery-job', (_event, jobId: string): void => {
  if (jobId === activeJobId) throw new Error('The active job cannot be dismissed.');
  const job = jobs.getById(jobId);
  if (!job) throw new Error('Job not found.');
  if (job.state !== 'COMPLETE' && job.state !== 'CANCELLED' && job.state !== 'FAILED_MANUAL') {
    jobMachine.transition(jobId, 'FAILED_MANUAL', 'interrupted job dismissed by user');
  }
});

ipcMain.handle(
  'save-portal-credentials',
  async (_event, portalId: string, input: SavePortalCredentialInput): Promise<PortalCredentialSettings> => {
    const portal = getPortalDefinition(portalId);
    const loginId = typeof input?.loginId === 'string' ? input.loginId.trim() : '';
    const rememberPassword = input?.rememberPassword === true;
    const current = portalCredentials.get(portal.id);

    if (!rememberPassword) {
      portalCredentials.save({ loginId, encryptedPasswordBase64: null }, portal.id);
      return credentialSettings(portal.id);
    }
    if (!loginId) throw new Error(`Enter the ${portal.name} login ID before saving the password.`);
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Secure password storage is unavailable on this computer.');
    }

    let encryptedPasswordBase64 = current.encryptedPasswordBase64;
    if (loginId !== current.loginId && !input.password) {
      encryptedPasswordBase64 = null;
    }
    if (typeof input.password === 'string' && input.password.length > 0) {
      const encrypted = await safeStorage.encryptStringAsync(input.password);
      encryptedPasswordBase64 = encrypted.toString('base64');
    }
    if (!encryptedPasswordBase64) throw new Error('Enter a password to save for assisted login.');
    portalCredentials.save({ loginId, encryptedPasswordBase64 }, portal.id);
    return credentialSettings(portal.id);
  }
);

/** Start Java Web Start on the verified file; resolves once the process is running. */
function startSigner(executable: string, jnlpPath: string): Promise<void> {
  return new Promise((resolveStart, rejectStart) => {
    const child = spawn(executable, [jnlpPath], { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', (error) => rejectStart(new Error(`Could not start OpenWebStart (${error.message}). Reinstall OpenWebStart and try again.`)));
    child.once('spawn', () => {
      child.unref();
      resolveStart();
    });
  });
}

ipcMain.handle('open-help-link', async (_event, url: unknown): Promise<void> => {
  // Only fixed help pages, never a URL chosen by page content.
  if (url !== OPENWEBSTART_DOWNLOAD_URL) throw new Error('This link is not allowed.');
  await shell.openExternal(url);
});

ipcMain.handle('launch-dsc-signer', async (_event, jobId: string): Promise<void> => {
  const artifact = dscArtifacts.get(jobId);
  if (!artifact) throw new Error('No verified DSC signer file is ready for this job.');
  const base = resolve(dscDownloadDirectory);
  const target = resolve(artifact.filePath);
  const childPath = relative(base, target);
  if (!childPath || childPath.startsWith('..') || isAbsolute(childPath)) {
    throw new Error('The DSC signer file is outside the protected download folder.');
  }
  if (!existsSync(target) || !isValidJnlpFile(target)) {
    throw new Error('The DSC signer file is missing or invalid. Download it again from TN Tenders.');
  }
  const launcher = detectJnlpLauncher();
  if (launcher.status === 'MISSING') throw new Error(MISSING_SIGNER_MESSAGE);
  if (launcher.executable) {
    await startSigner(launcher.executable, target);
  } else {
    const openError = await shell.openPath(target);
    if (openError) throw new Error(`Could not launch the DSC signer: ${openError}`);
  }
  if (activeJobId === jobId && lastActiveJobUpdate?.jobId === jobId) {
    emitJobUpdate({
      ...lastActiveJobUpdate,
      authStep: 'DSC_LAUNCHED',
      authErrorCode: undefined,
      recoveryAction: undefined,
    });
  }
});

ipcMain.handle('cancel-job', async (_event, jobId: string): Promise<void> => {
  if (!jobId || activeJobId !== jobId) throw new Error('This job is no longer running.');

  activeJobAbortController?.abort(USER_CANCELLED_REASON);
  activeStopWatchingSessionLoss?.();
  markJobCancelled(jobs, jobMachine, jobId);

  const session = sessions.getLatestForJob(jobId);
  const previous = lastActiveJobUpdate?.jobId === jobId ? lastActiveJobUpdate : undefined;
  emitJobUpdate({
    jobId,
    authSessionId: previous?.authSessionId ?? session?.id ?? '',
    authState: previous?.authState ?? session?.state ?? 'AUTH_PENDING',
    phase: previous?.phase,
    authStep: previous?.authStep,
    dscFileName: previous?.dscFileName,
    jobState: 'CANCELLED',
    outcome: 'ABORTED',
    abortReason: USER_CANCELLED_REASON,
  });

  portalHost?.close();
  // The renderer gets an immediate acknowledgement. Cooperative phase
  // cancellation and final cleanup continue on activeJobCompletion.
  void activeJobCompletion?.catch(() => {});
});

ipcMain.handle('get-job-detail', (_event, jobId: string): JobDetail => {
  const job = jobs.getById(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  const session = sessions.getLatestForJob(jobId);
  return {
    jobId: job.id,
    jobState: job.state,
    authSessionId: session?.id ?? null,
    authState: session?.state ?? null,
    jobTransitions: transitions.listFor('JOB', jobId),
    authTransitions: session ? transitions.listFor('AUTH_SESSION', session.id) : [],
    tenders: tenders.listForJob(jobId).map((tender) => ({
      ...tender,
      classification: classifications.getFinalForTender(tender.id),
      classificationGates: classifications.listForTender(tender.id),
      manualReview: workflow.getReview(tender.id) ?? null,
      effectiveClassification: workflow.getReview(tender.id)?.decision ?? classifications.getFinalForTender(tender.id),
      documents: workflow.listDocuments(tender.id),
      requirements: workflow.getRequirements(tender.id) ?? null,
      opportunityLifecycle: tender.opportunity_id ? opportunities.getById(tender.opportunity_id)?.lifecycle ?? null : null,
    })),
    searches: searches.listForJob(jobId),
    runConfiguration: runConfigurations.getForJob(jobId) ?? null,
  };
});

ipcMain.handle('delete-job', (_event, jobId: string): void => {
  if (jobId === activeJobId) {
    throw new Error('Cannot delete a job that is currently running.');
  }
  withTransaction(db, () => {
    transitions.deleteFor('JOB', jobId);
    for (const session of sessions.listAllForJob(jobId)) {
      transitions.deleteFor('AUTH_SESSION', session.id);
    }
    sessions.deleteAllForJob(jobId);
    opportunities.releaseJob(jobId);
    classifications.deleteForJob(jobId);
    workflow.deleteForJob(jobId);
    tenders.deleteForJob(jobId);
    searches.deleteForJob(jobId);
    runConfigurations.deleteForJob(jobId);
    jobs.delete(jobId);
  });
  dscArtifacts.delete(jobId);
});

// One active run at a time. The context carries what every stage of a run
// shares, so a fresh run and a resumed one use the same portal, sign-in,
// document collection, and cleanup steps.
interface RunContext {
  portal: PortalDefinition;
  config: RunConfiguration;
  outputSettings: PublishingSettings;
  abortController: AbortController;
  paceAction: PaceAction;
  page?: Page;
  stopWatchingSessionLoss?: () => void;
  /** The job currently running in this sign-in; one per published date. */
  jobId?: string;
}

/** Claim the single active-run slot synchronously, before any await. */
function claimRun(): { abortController: AbortController; paceAction: PaceAction } {
  if (activeJobId) {
    throw new Error('A job is already running. Wait for it to finish before starting another.');
  }
  activeJobId = 'pending';
  const abortController = new AbortController();
  activeJobAbortController = abortController;
  activeStopWatchingSessionLoss = undefined;
  lastActiveJobUpdate = undefined;
  activeSearchDate = undefined;
  activeBatch = undefined;
  activeRunPortalId = undefined;
  return { abortController, paceAction: createActionPacer(automationSettings.get(), abortController.signal) };
}

function releaseRun(abortController: AbortController): void {
  if (activeJobAbortController !== abortController) return;
  activeJobId = null;
  activeJobAbortController = undefined;
  activeStopWatchingSessionLoss = undefined;
  activeJobCompletion = undefined;
  lastActiveJobUpdate = undefined;
  activeSearchDate = undefined;
  activeBatch = undefined;
  activeRunPortalId = undefined;
  pendingMoreDates = undefined;
}

async function checkReadiness(portal: PortalDefinition, outputSettings: PublishingSettings): Promise<void> {
  const preflight = await runPreflight(outputSettings.localOutputRoot, portal.url, portal.name, outputSettings.driveOutputRoot);
  const blocker = preflight.checks.find((check) => check.level === 'BLOCKED');
  if (blocker) throw new Error(blocker.message);
}

/**
 * The portal page crashed or hung. Mark the signed-in session lost so the
 * running phase stops promptly; the run then reopens the portal and signs in
 * again with the saved login.
 */
function handlePortalCrash(reason: string): void {
  console.error(`[TenderAssist] portal page crashed (${reason})`);
  const sessionId = lastActiveJobUpdate?.authSessionId;
  const session = sessionId ? sessions.getById(sessionId) : undefined;
  if (!session || (session.state !== 'AUTH_PENDING' && session.state !== 'AUTHENTICATED')) return;
  authMachine.transition(session.id, 'TAB_LOST', `portal page crashed: ${reason}`);
  if (activeJobId && activeJobId !== 'pending') reactToAuthSessionLoss(jobMachine, activeJobId)('PAGE_CRASHED', 'TAB_LOST');
  // Closing the dead page makes any portal step still waiting on it fail at
  // once, so the run can reopen the portal instead of waiting forever.
  portalHost?.close();
}

async function openPortal(portal: PortalDefinition): Promise<void> {
  portalHost?.close();
  portalHost = new EmbeddedPortalHost(() => mainWindow, dscDownloadDirectory, portal);
  portalHost.onCrashed(handlePortalCrash);
  portalHost.setZoomPercent(displaySettings.getPortalZoom(portal.id));
  await portalHost.open(portal.url);
  await waitForCdpReady(EMBEDDED_CDP_PORT, 15000);
}

/** Run assisted sign-in; with `existingJobId`, the same job signs in again. */
function signIn(
  ctx: RunContext,
  credentials: PortalCredentials | undefined,
  onUpdate: (update: AuthJobUpdate) => void,
  existingJobId?: string
): Promise<AuthJobUpdate> {
  return runAuthJob(
    {
      jobs, sessions, jobMachine, authMachine,
      portalCredentials: credentials,
      targetUrlPrefix: embeddedPortalTargetPrefix(ctx.portal),
      registerDscReady: (listener) => portalHost!.onDscReady(listener),
      onDscJnlpReady: (jobId, artifact) => dscArtifacts.set(jobId, artifact),
      signal: ctx.abortController.signal,
      paceAction: ctx.paceAction,
      existingJobId,
      currentJobId: () => ctx.jobId,
    },
    `http://127.0.0.1:${EMBEDDED_CDP_PORT}`,
    ctx.portal.url,
    onUpdate,
    (page, stop) => {
      ctx.page = page;
      ctx.stopWatchingSessionLoss = stop;
      activeStopWatchingSessionLoss = stop;
    }
  );
}

/**
 * Download, extract, and publish for the confirmed selection. If the portal
 * signs the operator out (or no portal is open yet, when resuming), keep
 * the selection and saved files, ask for a fresh sign-in on the same job,
 * and continue without repeating search or classification.
 */
async function collectDocuments(ctx: RunContext, jobId: string, authSessionId: string, selectedTenderIds: string[]): Promise<AuthJobUpdate> {
  let result: AuthJobUpdate;
  for (let signIns = 0; ; signIns += 1) {
    result = await runPostProcessing(
      { jobs, sessions, jobMachine, tenders, classifications, workflow, outputs: jobOutputs, signal: ctx.abortController.signal },
      ctx.page,
      jobId,
      authSessionId,
      ctx.config,
      ctx.outputSettings.localOutputRoot,
      // Success is reported by the caller once the run really is finished.
      (update) => { if (update.outcome !== 'SUCCESS') emitJobUpdate(update); },
      ctx.portal.url,
      selectedTenderIds,
      ctx.outputSettings.structure
    );
    syncOpportunities('documents', () => recordCollectedDocuments(opportunitySync, jobId));
    if (result.outcome === 'SUCCESS') {
      // Tenders approved in the Inbox before this run had their documents
      // collected just now, so they go to Drive straight away.
      reportDriveProblems(copyApprovedTendersToDrive(tenders.listForJob(jobId)));
      // The caller reports success, since more dates may follow in this sign-in.
      return result;
    }
    if (result.abortReason !== PORTAL_SESSION_EXPIRED_REASON || result.outcome || ctx.abortController.signal.aborted) return result;
    if (signIns >= MAX_ACQUISITION_SIGN_INS) {
      jobMachine.transition(jobId, 'FAILED_MANUAL', 'portal session kept expiring during document acquisition');
      result = {
        ...result,
        jobState: 'FAILED_MANUAL',
        outcome: 'ABORTED',
        abortReason: 'The portal kept signing you out while documents downloaded. Files already saved are kept; start a new run to collect the rest.',
      };
      emitJobUpdate(result);
      return result;
    }
    ctx.stopWatchingSessionLoss?.();
    // A crashed page reports not open, and is replaced.
    if (!portalHost?.isOpen) await openPortal(ctx.portal);
    const credentials = await loadPortalCredentials(ctx.portal.id).catch(() => undefined);
    const signedIn = await signIn(ctx, credentials, emitJobUpdate, jobId);
    if (signedIn.outcome !== 'SUCCESS') return signedIn;
    authSessionId = signedIn.authSessionId;
  }
}

/**
 * Choose the tenders to download from the screening result, without
 * stopping the run, and remember the choice so an interrupted run can
 * resume downloads. This is not approval: the tenders stay in the Inbox.
 */
function selectAutomatically(jobId: string): string[] {
  const selected = automaticDownloadSelection(tenders.listForJob(jobId).map((tender) => ({
    id: tender.id,
    effectiveClassification: workflow.getReview(tender.id)?.decision ?? classifications.getFinalForTender(tender.id),
    opportunityLifecycle: tender.opportunity_id ? opportunities.getById(tender.opportunity_id)?.lifecycle ?? null : null,
  })));
  runConfigurations.saveSelection(jobId, selected);
  return selected;
}

// Lifecycles in which the operator has approved a tender.
const APPROVED_LIFECYCLES: readonly string[] = ['APPROVED', 'DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'PREPARING'];

/**
 * Copy approved tenders' saved folders from the local output folder to the
 * portal's Drive folder. Tenders without a saved folder, or portals without
 * a Drive folder, are skipped. Returns the problems, if any.
 */
function copyApprovedTendersToDrive(tenderRows: TenderRow[]): string[] {
  const problems: string[] = [];
  for (const tender of tenderRows) {
    const lifecycle = tender.opportunity_id ? opportunities.getById(tender.opportunity_id)?.lifecycle : undefined;
    if (!lifecycle || !APPROVED_LIFECYCLES.includes(lifecycle)) continue;
    const portalId = runConfigurations.getForJob(tender.job_id)?.portalId ?? DEFAULT_PORTAL_ID;
    const driveRoot = publishingSettings.get(portalId).driveOutputRoot;
    const plan = jobOutputs.getPlan(tender.job_id);
    const serialNumber = jobOutputs.findSerialNumber(tender.id);
    if (!driveRoot.trim() || !plan || serialNumber === undefined) continue;
    const folder = tenderOutputDirectory(plan.jobDirectory, tender, serialNumber, plan.structure, plan.outputDate);
    if (!existsSync(folder)) continue;
    try {
      mirrorTenderFolderToDrive(folder, plan.outputRoot, driveRoot);
    } catch (error) {
      problems.push(`${tender.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}

function reportDriveProblems(problems: string[]): void {
  if (problems.length === 0) return;
  dialog.showErrorBox(
    'Not copied to Drive',
    `The approval is saved, and the files are safe in the local output folder, but they could not be copied to Drive:\n\n${problems.join('\n')}\n\nCheck that the Drive folder in Settings exists and Google Drive is running, then approve again.`
  );
}

function approvedTenderRowsFor(opportunityIds: string[]): TenderRow[] {
  return opportunityIds.flatMap((id) => tenders.listForOpportunity(id));
}

/** Documents and Drive copy for tenders the operator just approved. */
function afterApproval(tenderRows: TenderRow[]): void {
  for (const jobId of new Set(tenderRows.map((tender) => tender.job_id))) {
    syncOpportunities('documents', () => recordCollectedDocuments(opportunitySync, jobId));
  }
  reportDriveProblems(copyApprovedTendersToDrive(tenderRows));
}

function runFinishedMessage(selectedCount: number, dateCount = 1): string {
  const dates = dateCount > 1 ? ` across ${dateCount} published dates` : '';
  if (selectedCount === 0) return `No tender matched your filters${dates}. Open a run to see what was checked.`;
  return `${selectedCount} tender${selectedCount === 1 ? '' : 's'} shortlisted${dates} and documents saved locally. Review them in the Inbox; approved tenders are copied to Drive.`;
}

/** A new job for the next published date, signed in through the session already open. */
function startDateJob(ctx: RunContext, searchDate: string): string {
  const job = jobs.create();
  jobMachine.transition(job.id, 'AUTH_REQUIRED', `next published date ${searchDate} in the same portal session`);
  jobMachine.transition(job.id, 'AUTH_PENDING', 'reusing the signed-in portal session');
  jobMachine.transition(job.id, 'AUTHENTICATED', 'portal session already signed in');
  runConfigurations.saveForJob(job.id, { ...ctx.config, searchDate });
  ctx.jobId = job.id;
  activeJobId = job.id;
  return job.id;
}

/** Search, screen, and collect documents for one published date. */
async function runDate(ctx: RunContext, jobId: string, authSessionId: string): Promise<{ result: AuthJobUpdate; selected: number }> {
  const config = runConfigurations.getForJob(jobId)!;
  // Shared, not copied: a sign-in again during downloads updates ctx.page for later dates.
  ctx.config = config;
  const { portal, abortController, paceAction } = ctx;
  const deps = { jobs, sessions, jobMachine, tenders, classifications, signal: abortController.signal, paceAction, portalHomeUrl: portal.url };
  const page = ctx.page!;
  const searchResult = await runSearchPhase(
    { ...deps, searches },
    page,
    jobId,
    authSessionId,
    emitJobUpdate,
    // Local midnight, so "YYYY-MM-DD" is the calendar day picked, not UTC.
    new Date(`${config.searchDate}T00:00:00`),
    config.productCategories.map((productCategory, index) => ({ searchKey: `search_${index + 1}`, productCategory })),
    { keywords: config.keywords, excludedKeywords: config.excludedKeywords }
  );
  // Record what the run saw even if the search stopped part-way.
  syncOpportunities('search', () => syncJobOpportunities(opportunitySync, jobId, portal.id, { screening: false }));
  if (searchResult.outcome !== 'SUCCESS') return { result: searchResult, selected: 0 };

  const classificationResult = await runClassificationPhase(deps, page, jobId, authSessionId, config, emitJobUpdate, portal.stateName);
  syncOpportunities('classification', () => syncJobOpportunities(opportunitySync, jobId, portal.id, { screening: classificationResult.outcome === 'SUCCESS' }));
  if (classificationResult.outcome !== 'SUCCESS') return { result: classificationResult, selected: 0 };

  // No pause for the operator: shortlisted and needs-review tenders are
  // downloaded in this signed-in session, and decided later in the Inbox.
  const selected = selectAutomatically(jobId);
  const result = await collectDocuments(ctx, jobId, authSessionId, selected);
  return { result, selected: selected.length };
}

// Times one date may sign in again after the portal crashes or signs out.
const MAX_DATE_RECOVERIES = 2;

function sessionWasLost(authSessionId: string): boolean {
  const state = sessions.getById(authSessionId)?.state;
  return state === 'TAB_LOST' || state === 'SESSION_EXPIRED';
}

function endJob(jobId: string, reason: string): void {
  const state = jobs.getById(jobId)?.state;
  if (state && state !== 'COMPLETE' && state !== 'CANCELLED' && state !== 'FAILED_MANUAL') jobMachine.transition(jobId, 'FAILED_MANUAL', reason);
}

/**
 * Reopen the portal and sign in again with the saved login ID and password,
 * as a fresh job for the date. The operator only enters CAPTCHA and DSC.
 */
async function signInAgainForDate(ctx: RunContext, date: string): Promise<{ jobId: string; authSessionId: string } | null> {
  ctx.stopWatchingSessionLoss?.();
  await openPortal(ctx.portal);
  const credentials = await loadPortalCredentials(ctx.portal.id).catch(() => undefined);
  let captured = false;
  const signedIn = await signIn(ctx, credentials, (update) => {
    if (!captured) {
      captured = true;
      ctx.jobId = update.jobId;
      activeJobId = update.jobId;
      runConfigurations.saveForJob(update.jobId, { ...ctx.config, searchDate: date });
    }
    emitJobUpdate({ ...update, statusMessage: 'The portal page stopped working, so TenderAssist reopened it. Your saved login is filled in; enter the CAPTCHA (and DSC if asked) to continue.' });
  });
  return signedIn.outcome === 'SUCCESS' ? { jobId: signedIn.jobId, authSessionId: signedIn.authSessionId } : null;
}

/** Waits for the operator to pick more dates (or finish) while the portal stays signed in. */
function waitForMoreDates(signal: AbortSignal): Promise<DateBatchPlan | null> {
  return new Promise((resolveChoice) => {
    if (signal.aborted) {
      resolveChoice(null);
      return;
    }
    const onAbort = () => {
      pendingMoreDates = undefined;
      resolveChoice(null);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pendingMoreDates = (choice) => {
      signal.removeEventListener('abort', onAbort);
      pendingMoreDates = undefined;
      resolveChoice(choice);
    };
  });
}

/**
 * Runs each published date as its own job in one sign-in, then asks whether
 * to run other dates before signing out. A date that does not finish stops
 * the batch; the dates left are named so the operator can start them again.
 */
async function runDateBatch(ctx: RunContext, firstJobId: string, authSessionId: string, plan: DateBatchPlan): Promise<void> {
  let dates = plan.toRun;
  let batch = { dates: [...dates], done: [] as string[], skipped: [...plan.skipped] };
  activeBatch = batch;
  let shortlisted = 0;
  let lastResult: AuthJobUpdate | undefined;
  for (let index = 0; ; index += 1) {
    const date = dates[index];
    if (date === undefined) {
      // Every chosen date has run. Keep the portal signed in and ask.
      const skippedNote = describeSkipped(batch.skipped);
      emitJobUpdate({
        ...lastResult!,
        outcome: undefined,
        awaitingMoreDates: true,
        statusMessage: `${runFinishedMessage(shortlisted, batch.done.length)}${skippedNote ? ` ${skippedNote}` : ''}`,
      });
      const more = await waitForMoreDates(ctx.abortController.signal);
      if (ctx.abortController.signal.aborted) return;
      if (!more) {
        emitJobUpdate({ ...lastResult!, awaitingMoreDates: false, outcome: 'SUCCESS', statusMessage: runFinishedMessage(shortlisted, batch.done.length) });
        return;
      }
      dates = [...dates, ...more.toRun];
      batch = { dates: [...dates], done: batch.done, skipped: [...batch.skipped, ...more.skipped] };
      activeBatch = batch;
      index -= 1;
      continue;
    }

    activeSearchDate = date;
    let jobId = index === 0 ? firstJobId : startDateJob(ctx, date);
    let { result, selected } = await runDate(ctx, jobId, authSessionId);
    // A crashed or signed-out portal restarts this date after signing in again.
    for (let recovery = 1; result.outcome !== 'SUCCESS' && recovery <= MAX_DATE_RECOVERIES && sessionWasLost(result.authSessionId || authSessionId); recovery += 1) {
      if (ctx.abortController.signal.aborted) break;
      endJob(jobId, 'portal page crashed or signed out; the date is restarted after signing in again');
      const signedIn = await signInAgainForDate(ctx, date);
      if (!signedIn) return;
      jobId = signedIn.jobId;
      authSessionId = signedIn.authSessionId;
      ({ result, selected } = await runDate(ctx, jobId, authSessionId));
    }
    lastResult = result;
    // A sign-in again during downloads gives the session a new id.
    authSessionId = result.authSessionId || authSessionId;
    if (result.outcome !== 'SUCCESS') {
      const remaining = dates.slice(index + 1);
      if (remaining.length > 0 && !ctx.abortController.signal.aborted) {
        emitJobUpdate({
          ...result,
          outcome: result.outcome ?? 'ABORTED',
          abortReason: `${result.abortReason ?? `The run for ${date} did not finish.`} These dates were not run: ${remaining.join(', ')}. Start the same range again to run them; finished dates are skipped.`,
        });
      }
      return;
    }
    shortlisted += selected;
    batch = { ...batch, done: [...batch.done, date] };
    activeBatch = batch;
  }
}

/**
 * The run only ever resolves with a terminal update; a rejection means
 * something broke outside its own control loop (e.g. the portal view
 * crashed). Report it so the UI never shows a dead run as running, then
 * log out best-effort, close the portal, and free the run slot.
 */
function finishRun(ctx: RunContext, run: Promise<unknown>, onFailure: (err: unknown) => void): Promise<void> {
  return run
    .then(() => undefined)
    .catch((err) => {
      console.error('Run failed unexpectedly:', err);
      onFailure(err);
      const failedJobId = activeJobId;
      if (failedJobId && failedJobId !== 'pending' && !ctx.abortController.signal.aborted) {
        const job = jobs.getById(failedJobId);
        const session = sessions.getLatestForJob(failedJobId);
        emitJobUpdate({
          jobId: failedJobId,
          authSessionId: session?.id ?? '',
          jobState: job?.state ?? 'FAILED_MANUAL',
          authState: session?.state ?? 'TAB_LOST',
          outcome: 'ABORTED',
          abortReason: err instanceof Error ? err.message : String(err),
        });
      }
    })
    .finally(async () => {
      ctx.stopWatchingSessionLoss?.();
      if (ctx.page) await attemptLogout(ctx.page);
      portalHost?.close();
      releaseRun(ctx.abortController);
    });
}

ipcMain.handle('start-job', async (_event, requestedConfig: RunConfiguration, untilDate?: unknown) => {
  const { abortController, paceAction } = claimRun();
  let ctx: RunContext;
  let plan: DateBatchPlan;
  let savedPortalCredentials: PortalCredentials | undefined;
  try {
    const config = normalizeRunConfiguration(requestedConfig);
    const portal = getPortalDefinition(config.portalId);
    config.portalId = portal.id;
    plan = planDatesToRun(portal.id, config.searchDate, typeof untilDate === 'string' && untilDate ? untilDate : config.searchDate);
    config.searchDate = plan.toRun[0];
    const outputSettings = publishingSettings.get(portal.id);
    ctx = { portal, config, outputSettings, abortController, paceAction };
    activeRunPortalId = portal.id;
    activeSearchDate = config.searchDate;
    await checkReadiness(portal, outputSettings);
    if (!runConfigurations.hasSavedDefaults()) {
      throw new Error('Save your product categories and intent in Settings before starting a job.');
    }
    savedPortalCredentials = await loadPortalCredentials(portal.id);
    await openPortal(portal);
  } catch (error) {
    // Claiming the slot synchronously means this handler owns freeing it on
    // an early failure; otherwise no later job could ever start.
    portalHost?.close();
    releaseRun(abortController);
    throw error;
  }

  let resolveStarted!: (jobId: string) => void;
  let rejectStarted!: (err: unknown) => void;
  const started = new Promise<string>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  let jobIdCaptured = false;

  const run = signIn(ctx, savedPortalCredentials, (update) => {
    if (!jobIdCaptured) {
      jobIdCaptured = true;
      activeJobId = update.jobId;
      ctx.jobId = update.jobId;
      runConfigurations.saveForJob(update.jobId, ctx.config);
      resolveStarted(update.jobId);
    }
    emitJobUpdate(update);
  }).then(async (authResult) => {
    if (authResult.outcome !== 'SUCCESS' || !ctx.page) return;
    await runDateBatch(ctx, authResult.jobId, authResult.authSessionId, plan);
  });

  // rejectStarted is a no-op once `started` resolved, but load-bearing if
  // sign-in fails before its first update.
  activeJobCompletion = finishRun(ctx, run, rejectStarted);
  return { jobId: await started, dates: plan.toRun, skipped: plan.skipped };
});

/** The dates in a range still to run for a portal; throws when there are none. */
function planDatesToRun(portalId: string, from: string, to: string): DateBatchPlan {
  const plan = planDateBatch(from, to, runConfigurations.listCompletedRunDates(portalId));
  if (plan.toRun.length === 0) {
    throw new Error(from === to
      ? `${from} already has a completed run for this portal. Its tenders are in the Inbox and Tenders pages.`
      : `Every date from ${from} to ${to} already has a completed run for this portal.`);
  }
  return plan;
}

ipcMain.handle('run-more-dates', (_event, from: unknown, to: unknown): DateBatchPlan => {
  if (!pendingMoreDates || !activeRunPortalId) throw new Error('The run is not waiting for more dates.');
  if (typeof from !== 'string' || typeof to !== 'string') throw new Error('Choose the published dates to run.');
  // Dates already run in this sign-in are not run twice.
  const queued = activeBatch?.dates ?? [];
  const plan = planDateBatch(from, to, [...runConfigurations.listCompletedRunDates(activeRunPortalId), ...queued]);
  if (plan.toRun.length === 0) throw new Error('Every date in that range has already been run.');
  pendingMoreDates(plan);
  return plan;
});

ipcMain.handle('finish-run', (): void => {
  if (!pendingMoreDates) throw new Error('The run is not waiting for more dates.');
  pendingMoreDates(null);
});

ipcMain.handle('resume-job', async (_event, jobId: string) => {
  const job = jobs.getById(jobId);
  const config = runConfigurations.getForJob(jobId);
  if (!job || !config) throw new Error('This run can no longer be resumed.');
  const plan = planResume({ jobState: job.state, selection: runConfigurations.getSelection(jobId) });
  if (plan.kind === 'START_OVER') throw new Error('This run stopped before the shortlist. Start it again instead.');

  const { abortController, paceAction } = claimRun();
  const portal = getPortalDefinition(config.portalId);
  const outputSettings = publishingSettings.get(portal.id);
  const ctx: RunContext = { portal, config, outputSettings, abortController, paceAction, jobId };
  activeSearchDate = config.searchDate;
  try {
    await checkReadiness(portal, outputSettings);
  } catch (error) {
    releaseRun(abortController);
    throw error;
  }
  activeJobId = jobId;
  const latestSession = sessions.getLatestForJob(jobId);

  const run = (async () => {
    if (plan.kind === 'SELECT_TENDERS') {
      // Sign in first so the downloads run in that session.
      await openPortal(portal);
      const credentials = await loadPortalCredentials(portal.id).catch(() => undefined);
      const signedIn = await signIn(ctx, credentials, emitJobUpdate, jobId);
      if (signedIn.outcome !== 'SUCCESS') return;
      const selected = selectAutomatically(jobId);
      const collected = await collectDocuments(ctx, jobId, signedIn.authSessionId, selected);
      if (collected.outcome === 'SUCCESS') emitJobUpdate({ ...collected, statusMessage: runFinishedMessage(selected.length) });
      return;
    }
    // Documents already chosen: saved files need no portal, and collection
    // asks for sign-in as soon as something still has to be downloaded.
    prepareForDocumentCollection(jobs, jobMachine, jobId);
    const collected = await collectDocuments(ctx, jobId, latestSession?.id ?? '', plan.selectedTenderIds);
    if (collected.outcome === 'SUCCESS') emitJobUpdate({ ...collected, statusMessage: runFinishedMessage(plan.selectedTenderIds.length) });
  })();
  activeJobCompletion = finishRun(ctx, run, () => {});
  return { jobId, plan: plan.kind };
});

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    configureApplicationMenu();
    mainWindow?.webContents.once('did-finish-load', reportRestoreOutcome);
    configureUpdates(() => mainWindow);
    if (app.isPackaged) {
      setTimeout(() => {
        void checkForUpdates(() => mainWindow).catch(() => {
          // checkForUpdates already records the recoverable failure in the
          // renderer-facing update status. Startup must never fail because
          // the release feed is unavailable.
        });
      }, 5000);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
