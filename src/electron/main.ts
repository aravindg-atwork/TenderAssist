// src/electron/main.ts
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, safeStorage, shell, type MenuItemConstructorOptions } from 'electron';
import { join, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
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
import { PortalCategoryRepository, type PortalCategoryList } from '../persistence/repositories/portalCategoryRepository.js';
import { AutomationSettingsRepository } from '../persistence/repositories/automationSettingsRepository.js';
import { DisplaySettingsRepository, type TextSize } from '../persistence/repositories/displaySettingsRepository.js';
import { TenderWorkflowRepository, type ManualTenderDecision } from '../persistence/repositories/tenderWorkflowRepository.js';
import { JobOutputRepository } from '../persistence/repositories/jobOutputRepository.js';
import { OpportunityRepository } from '../persistence/repositories/opportunityRepository.js';
import { applyTenderDecision, linkAllPossibleRetenders, recordCollectedDocuments, syncJobOpportunities } from '../orchestration/opportunitySync.js';
import { automaticDownloadSelection } from '../orchestration/automaticSelection.js';
import { describeSkipped, planDateBatch, type DateBatchPlan } from '../orchestration/dateBatch.js';
import { buildInbox, type InboxView } from '../review/inbox.js';
import { keyFactsFrom, parseDetailFields, type TenderFileView } from '../review/tenderFile.js';
import { buildTenders, type TendersView } from '../review/tenders.js';
import { describeTimeline, type TimelineEntry } from '../review/timeline.js';
import { collectAuditHistory, writeAuditWorkbook } from '../review/auditHistory.js';
import type { OperatorDecision, OpportunityLifecycle } from '../state/opportunityLifecycle.js';
import { JobStateMachine } from '../state/jobStateMachine.js';
import { AuthStateMachine } from '../state/authStateMachine.js';
import { getDatabasePath, getAppDataDir } from '../config/paths.js';
import { waitForCdpReady } from '../browser/chromeLauncher.js';
import { runAuthJob } from '../orchestration/authJobRunner.js';
import { runSearchPhase } from '../orchestration/searchPhaseRunner.js';
import { suggestWords, workDescriptionFrom, type DecidedTenderText, type WordSuggestions } from '../review/wordSuggestions.js';
import { RUN_QUESTION_TIMEOUT_MS, waitForAnswer, withRunState, type RunQuestion, type RunQuestionAnswer } from '../orchestration/runQuestion.js';
import { runClassificationPhase } from '../orchestration/classificationPhaseRunner.js';
import { PORTAL_SESSION_EXPIRED_REASON, runPostProcessing, saveTenderFiles, type DocumentDownloader } from '../orchestration/postProcessingRunner.js';
import { GemClient } from '../gem/gemClient.js';
import { bidFromTender, GEM_RETRY_DELAYS_MS, readGemBidDetails, runGemDate } from '../gem/gemRunner.js';
import { attemptLogout } from '../browser/logoutController.js';
import { reactToAuthSessionLoss } from '../browser/authJobCoordinator.js';
import type { Page } from 'playwright-core';
import type {
  JobListItem,
  JobDetail,
  DocumentsWaiting,
  RunSettingsState,
  PortalCredentialSettings,
  SavePortalCredentialInput,
  AuthJobUpdate,
  SettingsSection,
  GoogleDriveStatus,
} from './ipcTypes.js';
import { categoriesForPortal, normalizeRunConfiguration, type RunConfiguration } from '../config/runConfiguration.js';
import type { PortalCredentials } from '../browser/portalLoginController.js';
import { isValidJnlpFile, type DscJnlpArtifact } from '../browser/dscDownloadSecurity.js';
import { mirrorReportSheetsToDrive, mirrorTenderFolderToDrive, publishJobWorkbook, tenderDocumentsDirectory, tenderOutputDirectory } from '../publishing/jobPublisher.js';
import { resolveOutputStructure } from '../publishing/outputStructure.js';
import { GoogleDriveClient, parseDriveFolderId, parseGoogleClientFile, signInWithBrowser, type DriveCredentials } from '../publishing/googleDrive.js';
import { GoogleDriveSettingsRepository } from '../persistence/repositories/googleDriveSettingsRepository.js';
import { detailTextFor, downloadDetailDocuments, navigateToMyTenders, reviewTendersFromMyTenders } from '../browser/myTendersController.js';
import { parseTenderPortalDate } from '../search/tenderDateParser.js';
import { retryTransient } from '../orchestration/transientRetry.js';
import { checkForUpdates, configureUpdates, getUpdateStatus, restartToInstall } from './updateService.js';
import { runPreflight } from '../system/preflight.js';
import { detectJnlpLauncher, MISSING_SIGNER_MESSAGE, OPENWEBSTART_DOWNLOAD_URL } from '../system/jnlpLauncher.js';
import { spawn } from 'node:child_process';
import { applyPendingRestore, createBackup, inspectBackup, stageRestore } from '../system/backup.js';
import { buildSupportBundle } from '../system/supportBundle.js';
import { EmbeddedPortalHost, embeddedPortalTargetPrefix } from './embeddedPortalHost.js';
import { markJobCancelled, USER_CANCELLED_REASON } from '../orchestration/jobCancellation.js';
import { createActionPacer } from '../orchestration/actionPacer.js';
import { DEFAULT_PORTAL_ID, getPortalDefinition, isGemPortal, type PortalDefinition } from '../config/portalRegistry.js';
import { describeResumePlan, planResume, prepareForDocumentCollection } from '../orchestration/jobResume.js';
import type { PaceAction } from '../orchestration/actionPacer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMBEDDED_CDP_PORT = 18_000 + Math.floor(Math.random() * 10_000);
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-debugging-port', String(EMBEDDED_CDP_PORT));
// Indian English: date boxes read day/month/year (06/10/2026), not month first.
app.commandLine.appendSwitch('lang', 'en-IN');

// A development copy can run beside the installed app with its own folder
// (for example a first-time-user test): Electron finds its folder through
// Windows, not APPDATA, so the one-copy lock below would close it at once.
// Ignored in the installed app.
if (!app.isPackaged && process.env.TENDERASSIST_USER_DATA) {
  app.setPath('userData', process.env.TENDERASSIST_USER_DATA);
}

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
const portalCategories = new PortalCategoryRepository(db);
const displaySettings = new DisplaySettingsRepository(db);
const jobOutputs = new JobOutputRepository(db);
const opportunities = new OpportunityRepository(db);
const googleDriveSettings = new GoogleDriveSettingsRepository(db);
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
// Asks the sign-in in progress for a fresh DSC signer file.
let activeFreshSignerRequest: (() => void) | undefined;
// The active run's place in its range of published dates.
let activeSearchDate: string | undefined;
let activeBatch: AuthJobUpdate['batch'];
let activeRunPortalId: string | undefined;
// Resolves the "run other dates?" question: dates to run next, or null to finish.
let pendingMoreDates: ((choice: DateBatchPlan | null) => void) | undefined;
// The "Keep or skip?" question on screen, and how to deliver its answer.
let activeQuestion: RunQuestion | undefined;
let pendingAnswer: ((answer: RunQuestionAnswer) => void) | undefined;
const dscDownloadDirectory = join(getAppDataDir(), 'dsc-downloads');
const dscArtifacts = new Map<string, DscJnlpArtifact>();
// Fresh sign-ins allowed while collecting documents before the run stops.
const MAX_ACQUISITION_SIGN_INS = 3;

/**
 * A gentle pace for GeM's public pages: a short random pause before each
 * request. GeM answers "server error" when asked too quickly.
 */
function gemPause(signal: AbortSignal): () => Promise<void> {
  const fast = automationSettings.get().mode === 'FAST';
  return () => new Promise((resolvePause) => {
    if (signal.aborted) return resolvePause();
    const timer = setTimeout(done, fast ? 200 : 600 + Math.random() * 800);
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolvePause(); }
    signal.addEventListener('abort', done, { once: true });
  });
}

function gemClientFor(signal: AbortSignal): GemClient {
  return new GemClient({ signal, pause: gemPause(signal) });
}

/** GeM files are public: saved straight from GeM, retried while GeM is busy. */
function gemDownloader(client: GemClient, signal: AbortSignal): DocumentDownloader {
  return { get: (url) => retryTransient(() => client.fetchFile(url), { delaysMs: GEM_RETRY_DELAYS_MS, signal }) };
}

function preflightFor(portal: PortalDefinition, settings: PublishingSettings) {
  // GeM needs no sign-in, so no DSC signer either.
  return runPreflight(settings.localOutputRoot, portal.url, portal.name, settings.driveOutputRoot, isGemPortal(portal) ? null : undefined);
}

function emitJobUpdate(raw: AuthJobUpdate): void {
  const update: AuthJobUpdate = withRunState(raw, { searchDate: activeSearchDate, batch: activeBatch, question: activeQuestion });
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

/** The saved folder of a tender on this computer, newest run first, if one exists. */
function tenderFolderFor(opportunityId: string): string | null {
  for (const tender of [...tenders.listForOpportunity(opportunityId)].reverse()) {
    const plan = jobOutputs.getPlan(tender.job_id);
    const serialNumber = jobOutputs.findSerialNumber(tender.id);
    if (!plan || serialNumber === undefined) continue;
    const folder = tenderOutputDirectory(plan.jobDirectory, tender, serialNumber, plan.structure, plan.outputDate);
    if (existsSync(folder)) return folder;
  }
  return null;
}

ipcMain.handle('get-tender-file', (_event, opportunityId: unknown): TenderFileView => {
  if (typeof opportunityId !== 'string' || !opportunities.getById(opportunityId)) throw new Error('Tender not found.');
  const rows = [...tenders.listForOpportunity(opportunityId)].reverse();
  const read = rows.find((tender) => tender.detail_text);
  const allFields = parseDetailFields(read?.detail_text);
  const withDocuments = rows.find((tender) => workflow.listDocuments(tender.id).length > 0);
  const latest = rows[0];
  const foundOnDate = latest ? runConfigurations.getForJob(latest.job_id)?.searchDate ?? null : null;
  const listing = latest ? [
    { label: 'Reference', value: latest.tender_ref },
    { label: 'Category', value: latest.detail_product_category || latest.product_category },
    { label: 'Organisation', value: (latest.organisation_chain ?? '').replace(/\|\|/g, ' › ') },
    { label: 'Found when searching', value: foundOnDate ?? '' },
  ].filter((field) => field.value) : [];
  return {
    listing,
    foundOnDate,
    inMyTenders: rows.some((tender) => tender.favorited === 1),
    fromGem: isGemPortal(getPortalDefinition(opportunities.getById(opportunityId)?.portal_id)),
    opportunityId,
    keyFacts: keyFactsFrom(allFields),
    allFields,
    // Older reads also recorded portal menu links (such as "My Documents"); only files and the zip are documents.
    documents: (withDocuments ? workflow.listDocuments(withDocuments.id) : [])
      .filter((document) => /\.(?:pdf|xlsx?|docx?|zip|rar|7z|dwg|jpe?g|png|txt|csv)$/i.test(document.file_name) || /zip/i.test(document.file_name))
      .map((document) => ({
      id: document.id,
      name: document.file_name,
      state: document.state,
      error: document.error,
    })),
    hasFolder: tenderFolderFor(opportunityId) !== null,
    detailsRead: Boolean(read?.detail_reviewed_at),
  };
});

ipcMain.handle('open-tender-folder', async (_event, opportunityId: unknown): Promise<void> => {
  if (typeof opportunityId !== 'string') throw new Error('Tender not found.');
  const folder = tenderFolderFor(opportunityId);
  if (!folder) throw new Error('This tender has no saved folder on this computer yet.');
  const error = await shell.openPath(folder);
  if (error) throw new Error(`Could not open the folder: ${error}`);
});

ipcMain.handle('get-tender-timeline', (_event, opportunityId: unknown): TimelineEntry[] => {
  if (typeof opportunityId !== 'string' || !opportunities.getById(opportunityId)) throw new Error('Tender not found.');
  return describeTimeline(opportunities.listEvents(opportunityId));
});

ipcMain.handle('list-jobs', (): JobListItem[] => {
  return jobs.listAll().map((job) => {
    const session = sessions.getLatestForJob(job.id);
    const config = runConfigurations.getForJob(job.id);
    if (job.purpose === 'DOCUMENTS') {
      const ids = jobs.documentTenderIds(job);
      return {
        jobId: job.id, jobState: job.state, authState: session?.state ?? null,
        createdAt: job.created_at, updatedAt: job.updated_at,
        portalId: config?.portalId ?? DEFAULT_PORTAL_ID, searchDate: null,
        tendersFound: ids.length,
        kept: ids.filter((id) => workflow.listDocuments(id).some((document) => document.state === 'DOWNLOADED')).length,
        purpose: 'DOCUMENTS' as const,
      };
    }
    const found = tenders.listForJob(job.id);
    return {
      purpose: 'SEARCH' as const,
      jobId: job.id,
      jobState: job.state,
      authState: session?.state ?? null,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      portalId: config?.portalId ?? DEFAULT_PORTAL_ID,
      searchDate: config?.searchDate ?? null,
      tendersFound: found.length,
      kept: found.filter((tender) => (workflow.getReview(tender.id)?.decision ?? classifications.getFinalForTender(tender.id)) === 'KEEP').length,
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

ipcMain.handle('get-word-suggestions', (): WordSuggestions => {
  const textOf = (opportunityId: string, title: string): DecidedTenderText => {
    const withDetails = tenders.listForOpportunity(opportunityId).filter((tender) => tender.detail_text).at(-1);
    return { title, description: workDescriptionFrom(withDetails?.detail_text ?? null) };
  };
  const decided = (lifecycles: OpportunityLifecycle[]) => opportunities.list({ lifecycles }).map((row) => textOf(row.id, row.title));
  const defaults = runConfigurations.getDefaults();
  return suggestWords({
    approved: decided(['APPROVED', 'DOCUMENTS_COLLECTED']),
    rejected: decided(['REJECTED']),
    keywords: defaults.keywords,
    excludedKeywords: defaults.excludedKeywords,
  });
});

// GeM's list is public: read it from GeM when it is missing or two weeks old.
const GEM_CATEGORY_LIST_MAX_AGE_MS = 14 * 86_400_000;

/**
 * GeM's Category dropdown, services and products, exactly as GeM shows it
 * with each entry's code. Read from GeM when missing or two weeks old.
 */
async function gemCategoryLists(portal: PortalDefinition): Promise<{ services: PortalCategoryList; products: PortalCategoryList }> {
  const productsKey = `${portal.id}:products`;
  let services = portalCategories.get(portal.id);
  let products = portalCategories.get(productsKey);
  if (!services.readAt || !services.codes || Date.now() - Date.parse(services.readAt) > GEM_CATEGORY_LIST_MAX_AGE_MS) {
    try {
      // GeM's random "server error" answers pass within seconds.
      const list = await retryTransient(() => new GemClient({ timeoutMs: 60_000 }).categoryList(), { delaysMs: [2_000, 5_000] });
      const codesOf = (entries: Array<{ name: string; code: string }>) => Object.fromEntries(entries.map((entry) => [entry.name, entry.code]));
      const readAt = new Date().toISOString();
      services = portalCategories.save(portal.id, list.services.map((entry) => entry.name), readAt, codesOf(list.services));
      products = portalCategories.save(productsKey, list.products.map((entry) => entry.name), readAt, codesOf(list.products));
    } catch (error) {
      // The saved list (if any) still works; the picker says when it was read.
      console.error('[TenderAssist] GeM category list not read:', error);
    }
  }
  return { services, products };
}

/** GeM's code for each category name, so bids are matched the way GeM's own search matches them. */
async function gemCategoryCodes(portal: PortalDefinition): Promise<Map<string, string>> {
  const { services, products } = await gemCategoryLists(portal);
  const codes = new Map<string, string>();
  for (const [name, code] of Object.entries({ ...products.codes, ...services.codes })) codes.set(name.toLocaleLowerCase(), code);
  return codes;
}

ipcMain.handle('get-portal-categories', async (_event, portalId: string, options?: { includeProducts?: unknown }): Promise<PortalCategoryList> => {
  const portal = getPortalDefinition(portalId);
  if (!isGemPortal(portal)) return portalCategories.get(portal.id);
  const { services, products } = await gemCategoryLists(portal);
  const shown = (list: PortalCategoryList) => ({ categories: list.categories, readAt: list.readAt });
  if (options?.includeProducts !== true) return shown(services);
  return { categories: [...services.categories, ...products.categories], readAt: services.readAt };
});

ipcMain.handle('get-portal-credential-settings', async (_event, portalId: string): Promise<PortalCredentialSettings> => {
  return credentialSettings(getPortalDefinition(portalId).id);
});

ipcMain.handle('get-publishing-settings', (_event, portalId: string) => publishingSettings.get(getPortalDefinition(portalId).id));
ipcMain.handle('save-publishing-settings', (_event, portalId: string, settings) => publishingSettings.save(settings, getPortalDefinition(portalId).id));
ipcMain.handle('get-google-drive', () => googleDriveStatus());

ipcMain.handle('save-google-drive', async (_event, input: unknown): Promise<GoogleDriveStatus> => {
  const value = (input ?? {}) as { folderLink?: unknown; uploadMode?: unknown };
  const current = googleDriveSettings.get();
  if (value.uploadMode === 'SAVED' || value.uploadMode === 'APPROVED') {
    googleDriveSettings.save({ ...current, uploadMode: value.uploadMode });
    if (typeof value.folderLink !== 'string') return googleDriveStatus();
  }
  const folderLink = typeof value.folderLink === 'string' ? value.folderLink.trim() : '';
  const folderId = folderLink ? parseDriveFolderId(folderLink) : '';
  if (folderLink && !folderId) throw new Error('That does not look like a Google Drive folder link. Open the folder in Drive and copy the address from the browser.');
  googleDriveSettings.save({ ...googleDriveSettings.get(), folderId: folderId ?? '', folderName: folderId === current.folderId ? current.folderName : '' });
  // Check a new folder straight away when already signed in.
  const drive = await googleDriveClient();
  if (drive && folderId && folderId !== current.folderId) {
    const folder = await drive.client.folder(folderId);
    googleDriveSettings.save({ ...googleDriveSettings.get(), folderName: folder.name });
  }
  return googleDriveStatus();
});

ipcMain.handle('connect-google-drive', async (): Promise<GoogleDriveStatus> => {
  const credentials = builtInGoogleClient();
  if (!credentials) throw new Error('This copy of TenderAssist was built without Google sign-in. Ask for a build that includes it.');
  const settings = googleDriveSettings.get();
  if (!settings.folderId) throw new Error('Paste the Drive folder link and save it first.');
  try {
    const { refreshToken } = await signInWithBrowser(credentials, async (url) => {
      googleSignInLink = url;
      await shell.openExternal(url);
    });
    const client = new GoogleDriveClient(credentials, refreshToken);
    const [account, folder] = await Promise.all([client.account(), client.folder(settings.folderId)]);
    googleDriveSettings.save({
      ...googleDriveSettings.get(),
      refreshTokenEncrypted: await encryptText(refreshToken),
      accountEmail: account.email,
      folderName: folder.name,
      connectedAt: new Date().toISOString(),
    });
    return googleDriveStatus();
  } finally {
    googleSignInLink = null;
  }
});

ipcMain.handle('check-google-drive', async (): Promise<GoogleDriveStatus> => {
  const drive = await googleDriveClient();
  if (!drive) throw new Error('Google Drive is not signed in yet.');
  const [account, folder] = await Promise.all([drive.client.account(), drive.client.folder(drive.folderId)]);
  googleDriveSettings.save({ ...googleDriveSettings.get(), accountEmail: account.email, folderName: folder.name });
  return googleDriveStatus();
});

ipcMain.handle('upload-everything-to-google-drive', async (): Promise<GoogleDriveStatus> => {
  if (!(await googleDriveClient())) throw new Error('Sign in to Google first.');
  await uploadEverythingToGoogleDrive();
  return googleDriveStatus();
});

ipcMain.handle('disconnect-google-drive', async (): Promise<GoogleDriveStatus> => {
  googleDriveSettings.save({ ...googleDriveSettings.get(), refreshTokenEncrypted: null, accountEmail: '', connectedAt: null });
  return googleDriveStatus();
});

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
  const portal = getPortalDefinition(config.portalId);
  return publishJobWorkbook(plan.outputRoot, plan.outputDate, jobId, numbered, plan.structure, plan.runNumber, { url: portal.url, name: portal.name });
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
  return preflightFor(portal, settings);
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
  if (job?.state === 'COMPLETE' || job?.state === 'REPORTING') {
    await publishStoredJob(tender.job_id);
    uploadRunToGoogleDrive(tender.job_id);
  }
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

ipcMain.handle('refresh-dsc-signer', (_event, jobId: string): void => {
  if (!jobId || activeJobId !== jobId) throw new Error('This job is no longer running.');
  if (!activeFreshSignerRequest) throw new Error('The run is not signing in right now.');
  activeFreshSignerRequest();
  if (lastActiveJobUpdate?.jobId === jobId) {
    emitJobUpdate({ ...lastActiveJobUpdate, authStep: 'DSC_LOGIN_STARTING', dscFileName: undefined, authErrorCode: undefined, recoveryAction: undefined });
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
  const documentRun = job.purpose === 'DOCUMENTS';
  // A documents run's tenders belong to the searches that found them; all were approved.
  const runTenders = documentRun
    ? jobs.documentTenderIds(job).map((id) => tenders.getById(id)).filter((tender): tender is TenderRow => Boolean(tender))
    : tenders.listForJob(jobId);
  return {
    jobId: job.id,
    jobState: job.state,
    purpose: documentRun ? 'DOCUMENTS' : 'SEARCH',
    authSessionId: session?.id ?? null,
    authState: session?.state ?? null,
    jobTransitions: transitions.listFor('JOB', jobId),
    authTransitions: session ? transitions.listFor('AUTH_SESSION', session.id) : [],
    tenders: runTenders.map((tender) => ({
      ...tender,
      classification: classifications.getFinalForTender(tender.id),
      classificationGates: classifications.listForTender(tender.id),
      manualReview: workflow.getReview(tender.id) ?? null,
      effectiveClassification: documentRun ? 'KEEP' as const : workflow.getReview(tender.id)?.decision ?? classifications.getFinalForTender(tender.id),
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
  /** The session's first date also checks every undecided favourite, whatever its date. */
  checkAllUndecided?: boolean;
  /** A question went unanswered: the operator is away, so the rest of the run does not wait. */
  operatorAway?: boolean;
  /** GeM runs: no portal page; files come straight from GeM. */
  gem?: GemClient;
  downloader?: DocumentDownloader;
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
  activeQuestion = undefined;
  pendingAnswer = undefined;
}

async function checkReadiness(portal: PortalDefinition, outputSettings: PublishingSettings): Promise<void> {
  const preflight = await preflightFor(portal, outputSettings);
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
  // Pop-ups show in the portal view while the operator signs in.
  portalHost?.setAutomationPopups(false);
  return runAuthJob(
    {
      jobs, sessions, jobMachine, authMachine,
      portalCredentials: credentials,
      targetUrlPrefix: embeddedPortalTargetPrefix(ctx.portal),
      registerDscReady: (listener) => portalHost!.onDscReady(listener),
      registerFreshSigner: (request) => {
        activeFreshSignerRequest = request;
        return () => { if (activeFreshSignerRequest === request) activeFreshSignerRequest = undefined; };
      },
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
  ).then((result) => {
    // Signed in: automation reads tender pop-ups in hidden windows.
    if (result.outcome === 'SUCCESS') portalHost?.setAutomationPopups(true);
    return result;
  });
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
      { jobs, sessions, jobMachine, tenders, classifications, workflow, outputs: jobOutputs, signal: ctx.abortController.signal, downloader: ctx.downloader },
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
      // Drive gets what this computer got, when the operator chose that.
      uploadRunToGoogleDrive(jobId);
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
  const selected = selectionFor(jobId);
  runConfigurations.saveSelection(jobId, selected);
  return selected;
}

/** The tenders a run collects: kept from their details page, or approved by the operator. */
function selectionFor(jobId: string): string[] {
  return automaticDownloadSelection(tenders.listForJob(jobId).map((tender) => ({
    id: tender.id,
    effectiveClassification: workflow.getReview(tender.id)?.decision ?? classifications.getFinalForTender(tender.id),
    opportunityLifecycle: tender.opportunity_id ? opportunities.getById(tender.opportunity_id)?.lifecycle ?? null : null,
  })));
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
  const sheetsCopied = new Set<string>();
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
      // The day's report sheet goes with it, once per day folder.
      if (!sheetsCopied.has(plan.jobDirectory)) {
        sheetsCopied.add(plan.jobDirectory);
        mirrorReportSheetsToDrive(plan.jobDirectory, plan.outputRoot, driveRoot, resolveOutputStructure(plan.structure, plan.outputDate).approvedWorkbook);
      }
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

// ── Google Drive: direct upload through Google's Drive API ──────────────────

async function encryptText(value: string): Promise<string> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('Secure storage is not available on this computer, so the Google sign-in cannot be saved.');
  return (await safeStorage.encryptStringAsync(value)).toString('base64');
}

async function decryptText(value: string | null): Promise<string | null> {
  if (!value) return null;
  try { return (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result; }
  catch { return null; }
}

/** A Drive client for the saved sign-in, or null when Drive is not set up and signed in. */
/**
 * TenderAssist's own Google sign-in credential, packed into the build from
 * google-oauth-client.json (kept out of git). Operators never see it.
 */
function builtInGoogleClient(): DriveCredentials | null {
  try { return parseGoogleClientFile(readFileSync(join(app.getAppPath(), 'google-oauth-client.json'), 'utf8')); }
  catch { return null; }
}

async function googleDriveClient(): Promise<{ client: GoogleDriveClient; folderId: string } | null> {
  const settings = googleDriveSettings.get();
  const credentials = builtInGoogleClient();
  const refreshToken = await decryptText(settings.refreshTokenEncrypted);
  if (!credentials || !refreshToken || !settings.folderId) return null;
  return { client: new GoogleDriveClient(credentials, refreshToken), folderId: settings.folderId };
}

// The Google sign-in address while a sign-in waits, for opening it in another browser.
let googleSignInLink: string | null = null;

async function googleDriveStatus(): Promise<GoogleDriveStatus> {
  const settings = googleDriveSettings.get();
  return {
    available: builtInGoogleClient() !== null,
    signInLink: googleSignInLink,
    folderId: settings.folderId,
    folderName: settings.folderName,
    accountEmail: settings.accountEmail,
    signedIn: Boolean(settings.refreshTokenEncrypted),
    encryptionAvailable: await safeStorage.isAsyncEncryptionAvailable(),
    uploadMode: settings.uploadMode,
    uploading: driveUploading,
    lastUpload: lastDriveUpload,
  };
}

let lastDriveUpload: GoogleDriveStatus['lastUpload'] = null;
let driveUploading = false;
// Uploads run one after another in the background; approving never waits on Drive.
let driveUploads: Promise<void> = Promise.resolve();

interface DriveUploadSummary { tenders: number; files: number; problems: string[] }

/**
 * Uploads tenders' saved folders, and the report sheets of their day folders,
 * to the Google Drive folder in the same layout as the local output folder.
 * Queued one batch after another in the background; nothing waits on Drive.
 */
function uploadToGoogleDrive(tenderRows: TenderRow[], extraDayDirectories: Array<{ jobId: string }> = [], label = 'Google Drive upload'): Promise<DriveUploadSummary | null> {
  const run = driveUploads.then(async (): Promise<DriveUploadSummary | null> => {
    const drive = await googleDriveClient();
    if (!drive) return null;
    driveUploading = true;
    const summary: DriveUploadSummary = { tenders: 0, files: 0, problems: [] };
    const days = new Map<string, { plan: NonNullable<ReturnType<typeof jobOutputs.getPlan>> }>();
    for (const { jobId } of extraDayDirectories) {
      const plan = jobOutputs.getPlan(jobId);
      if (plan && existsSync(plan.jobDirectory)) days.set(plan.jobDirectory, { plan });
    }
    try {
      for (const tender of tenderRows) {
        const plan = jobOutputs.getPlan(tender.job_id);
        const serialNumber = jobOutputs.findSerialNumber(tender.id);
        if (!plan || serialNumber === undefined) continue;
        const folder = tenderOutputDirectory(plan.jobDirectory, tender, serialNumber, plan.structure, plan.outputDate);
        if (!existsSync(folder)) continue;
        days.set(plan.jobDirectory, { plan });
        try {
          const segments = relative(resolve(plan.outputRoot), resolve(folder)).split(/[\/]+/).filter(Boolean);
          const dayId = await drive.client.ensurePath(drive.folderId, segments.slice(0, -1));
          const report = await drive.client.putFolder(await drive.client.ensureFolder(dayId, segments[segments.length - 1]), folder);
          summary.tenders += 1;
          summary.files += report.uploaded;
          if (tender.opportunity_id && report.uploaded > 0) {
            const id = tender.opportunity_id;
            syncOpportunities('drive', () => opportunities.addNote(id, `Uploaded to Google Drive: ${[googleDriveSettings.get().folderName, ...segments].join(' / ')} (${report.uploaded} new or changed ${report.uploaded === 1 ? 'file' : 'files'}).`, 'automation', { jobId: tender.job_id }));
          }
        } catch (error) {
          summary.problems.push(`${tender.title}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // Each day's report sheet(s), next to its tender folders.
      for (const { plan } of days.values()) {
        try {
          const segments = relative(resolve(plan.outputRoot), resolve(plan.jobDirectory)).split(/[\/]+/).filter(Boolean);
          const dayId = await drive.client.ensurePath(drive.folderId, segments);
          const sheetName = resolveOutputStructure(plan.structure, plan.outputDate).approvedWorkbook.replace(/\.xlsx$/i, '').toLocaleLowerCase();
          for (const name of readdirSync(plan.jobDirectory)) {
            if (/\.xlsx$/i.test(name) && name.toLocaleLowerCase().startsWith(sheetName)) {
              if (await drive.client.putFile(dayId, join(plan.jobDirectory, name), name) === 'uploaded') summary.files += 1;
            }
          }
        } catch (error) {
          summary.problems.push(`Report sheet for ${plan.outputDate}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      driveUploading = false;
    }
    lastDriveUpload = { at: new Date().toISOString(), uploaded: summary.tenders, failed: summary.problems.length, problem: summary.problems[0] ?? null };
    if (summary.problems.length > 0) {
      dialog.showErrorBox('Not uploaded to Google Drive',
        `The files are safe in the local output folder, but these could not be uploaded to Google Drive:\n\n${summary.problems.join('\n')}\n\nCheck the internet connection, then use Settings → Upload to Google Drive → "Upload everything saved so far" (files already on Drive are not sent again).`);
    } else if (summary.files > 0 && Notification.isSupported()) {
      new Notification({ title: 'Uploaded to Google Drive', body: `${summary.tenders} ${summary.tenders === 1 ? 'tender' : 'tenders'} and report sheets are in “${googleDriveSettings.get().folderName}”.` }).show();
    }
    return summary;
  });
  driveUploads = run.then(() => undefined, (error) => { console.error(`[TenderAssist] ${label} failed:`, error); });
  return run.catch(() => null);
}

/** Tenders whose files were just saved (for example by "Collect their documents"): their folders and report sheets. */
function uploadSavedTendersToGoogleDrive(tenderRows: TenderRow[]): void {
  if (tenderRows.length > 0) void uploadToGoogleDrive(tenderRows, tenderRows.map((tender) => ({ jobId: tender.job_id })), 'saved tenders upload');
}

/** Drive mirrors this computer: after a run, everything it saved (tender folders with documents, and the report sheet). */
function uploadRunToGoogleDrive(jobId: string): void {
  void uploadToGoogleDrive(tenders.listForJob(jobId), [{ jobId }], 'run upload');
}

/** Everything saved on this computer so far: every run's tender folders and report sheets. */
function uploadEverythingToGoogleDrive(): Promise<DriveUploadSummary | null> {
  const jobIds = jobs.listAll().map((job) => job.id).filter((id) => jobOutputs.getPlan(id));
  const rows = jobIds.flatMap((id) => tenders.listForJob(id));
  return uploadToGoogleDrive(rows, jobIds.map((jobId) => ({ jobId })), 'upload of everything saved');
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

interface CollectedCounts { shortlisted: number; needsReview: number }

/**
 * What a search found: tenders kept (by TenderAssist, or by the operator
 * during the run) and tenders left for a look. Counted from the run itself,
 * so a date searched again reports what it found, not only new downloads.
 */
function countFound(jobId: string): CollectedCounts {
  let shortlisted = 0;
  let needsReview = 0;
  for (const tender of tenders.listForJob(jobId)) {
    const decision = workflow.getReview(tender.id)?.decision ?? classifications.getFinalForTender(tender.id);
    if (decision === 'KEEP') shortlisted += 1;
    else if (decision === 'UNCERTAIN') needsReview += 1;
  }
  return { shortlisted, needsReview };
}

/** Whether runs copy what they save to Google Drive. */
function runsUploadToDrive(): boolean {
  const settings = googleDriveSettings.get();
  return Boolean(settings.refreshTokenEncrypted && settings.folderId) && builtInGoogleClient() !== null;
}

function runFinishedMessage(counts: CollectedCounts, dateCount = 1): string {
  const dates = dateCount > 1 ? ` across ${dateCount} published dates` : '';
  const drive = runsUploadToDrive() ? ` The report sheet${counts.shortlisted > 0 ? ' and kept tenders are' : ' is'} being uploaded to Google Drive.` : '';
  if (counts.shortlisted + counts.needsReview === 0) return `No tender matched your filters${dates}. Open a run to see what was checked.${drive}`;
  const parts = [
    counts.shortlisted > 0 && `${counts.shortlisted} shortlisted`,
    counts.needsReview > 0 && `${counts.needsReview} need${counts.needsReview === 1 ? 's' : ''} your review`,
  ].filter(Boolean).join(' and ');
  return `${parts}${dates}. Kept tenders' documents are saved in your folder.${drive} Decide them on the Today page.`;
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

/** SHA-256 of a saved file, read in pieces so a large zip is not loaded at once. */
function fileChecksum(filePath: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    createReadStream(filePath).on('data', (chunk) => hash.update(chunk)).on('error', rejectHash).on('end', () => resolveHash(hash.digest('hex')));
  });
}

/**
 * Clicks every document and the zip on a kept tender's open details page,
 * saving them in the tender's Documents folder, and records each result.
 */
async function saveTenderDocuments(ctx: RunContext, jobId: string, config: RunConfiguration, tender: TenderRow, detailPage: Page): Promise<void> {
  const host = portalHost;
  if (!host) return;
  const plan = jobOutputs.getOrCreatePlan(jobId, ctx.outputSettings.localOutputRoot, config.searchDate, ctx.outputSettings.structure);
  const directory = tenderDocumentsDirectory(plan.jobDirectory, tender, jobOutputs.serialNumberFor(plan, tender.id), plan.structure, plan.outputDate);
  const results = await downloadDetailDocuments(detailPage, (click) => host.captureDocument(directory, click), ctx.paceAction);
  for (const result of results) {
    const document = workflow.upsertDocument(tender.id, result.url, result.fileName);
    if (result.filePath) {
      workflow.completeDocument(document.id, result.fileName, result.filePath, await fileChecksum(result.filePath));
    } else {
      workflow.failDocument(document.id, result.error ?? 'The file did not download.');
    }
  }
}

/**
 * Adds to this run the date's (or, with a null date, every date's) earlier favourites that were never decided
 * from their details page, so My Tenders checks them like new ones. A
 * tender already decided (kept or rejected from its details) is left alone.
 */
function carryOverUndecidedFavourites(jobId: string, portalId: string, searchDate: string | null): void {
  const inThisRun = new Set(tenders.listForJob(jobId).map((tender) => tender.tender_portal_id ?? tender.tender_ref));
  const carried = new Set<string>();
  for (const earlier of tenders.listEarlierFavourites(jobId, portalId, searchDate)) {
    const key = earlier.tender_portal_id ?? earlier.tender_ref;
    if (inThisRun.has(key) || carried.has(key)) continue;
    carried.add(key);
    // The newest earlier row tells whether this tender was ever properly decided,
    // and a tender the operator has decided is theirs: it is never re-checked.
    if (earlier.detail_reviewed_at && classifications.getFinalForTender(earlier.id) !== 'UNCERTAIN') continue;
    const lifecycle = earlier.opportunity_id ? opportunities.getById(earlier.opportunity_id)?.lifecycle : undefined;
    if (lifecycle && lifecycle !== 'NEW' && lifecycle !== 'SCREENED') continue;
    const tender = tenders.upsert({
      jobId,
      tenderRef: earlier.tender_ref,
      tenderPortalId: earlier.tender_portal_id,
      title: earlier.title,
      organisationChain: earlier.organisation_chain,
      department: earlier.department,
      stateName: earlier.state_name,
      publishedDate: earlier.published_date,
      closingDate: earlier.closing_date,
      openingDate: earlier.opening_date,
      productCategory: earlier.product_category,
      valueInRupees: earlier.value_in_rupees,
    });
    tenders.markFavorited(tender.id, earlier.favorited_at ?? new Date().toISOString());
  }
}

/**
 * Asks the operator to keep or skip one unsure tender while its details page
 * is open. Their answer is their decision on the tender; with no answer the
 * tender waits in "Needs a look" with a note saying why.
 */
/** The durable tender a run's tender belongs to, recorded now if it is new. */
function syncedOpportunityId(tender: TenderRow, ctx: RunContext, jobId: string): string | null {
  let opportunityId = tender.opportunity_id ?? null;
  syncOpportunities('question', () => { opportunityId = opportunities.recordSighting(tender, ctx.portal.id, { jobId }).id; });
  return opportunityId;
}

async function askOperatorDuringRun(ctx: RunContext, jobId: string, tender: TenderRow, reason: string, documentUrl?: string): Promise<RunQuestionAnswer | null> {
  const signal = ctx.abortController.signal;
  const fresh = tenders.getById(tender.id) ?? tender;
  if (ctx.operatorAway) {
    // An earlier question went unanswered: leave this one for the Inbox without waiting.
    const id = syncedOpportunityId(fresh, ctx, jobId);
    if (id) syncOpportunities('question', () => opportunities.addNote(id, `Left for you: an earlier question in this run went unanswered, so TenderAssist stopped asking. ${reason}`, 'automation', { jobId }));
    return null;
  }
  activeQuestion = {
    id: randomUUID(),
    tenderTitle: fresh.title,
    tenderId: fresh.tender_portal_id,
    reference: fresh.tender_ref,
    organisation: fresh.department ?? fresh.organisation_chain,
    category: fresh.detail_product_category ?? fresh.product_category,
    closingDate: fresh.closing_date,
    value: fresh.value_in_rupees,
    reason,
    documentUrl,
    answerBy: new Date(Date.now() + RUN_QUESTION_TIMEOUT_MS).toISOString(),
  };
  if (lastActiveJobUpdate) emitJobUpdate({ ...lastActiveJobUpdate, outcome: undefined, statusMessage: `Waiting for your answer on ${fresh.title}.` });
  // Flash the taskbar button so the question is noticed behind other windows.
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) mainWindow.flashFrame(true);
  const answer = await waitForAnswer((deliver) => { pendingAnswer = deliver; }, RUN_QUESTION_TIMEOUT_MS, signal);
  activeQuestion = undefined;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false);
  if (!answer && !signal.aborted) ctx.operatorAway = true;
  if (lastActiveJobUpdate) {
    emitJobUpdate({
      ...lastActiveJobUpdate,
      question: undefined,
      statusMessage: answer === 'KEEP' ? `Kept ${fresh.title}. Saving its documents.`
        : answer === 'SKIP' ? `Skipped ${fresh.title}.`
          : `No answer, so ${fresh.title} waits in Needs a look. TenderAssist will not stop to ask again in this run.`,
    });
  }
  if (signal.aborted) return null;
  const opportunityId = syncedOpportunityId(fresh, ctx, jobId);
  if (answer) {
    const note = 'Answered during the run.';
    workflow.saveReview(tender.id, answer === 'KEEP' ? 'KEEP' : 'REJECT', note);
    syncOpportunities('question', () => applyTenderDecision(opportunitySync, opportunityId, answer === 'KEEP' ? 'APPROVE' : 'REJECT', { jobId, note }));
  } else if (opportunityId) {
    const id = opportunityId;
    const minutes = Math.round(RUN_QUESTION_TIMEOUT_MS / 60_000);
    syncOpportunities('question', () => opportunities.addNote(id, `Skipped during the run because nobody answered within ${minutes} minutes. ${reason}`, 'automation', { jobId }));
  }
  return answer;
}

/** Search, screen, and collect documents for one published date. */
async function runDate(ctx: RunContext, jobId: string, authSessionId: string): Promise<{ result: AuthJobUpdate; selected: CollectedCounts }> {
  const config = runConfigurations.getForJob(jobId)!;
  // Shared, not copied: a sign-in again during downloads updates ctx.page for later dates.
  ctx.config = config;
  const { portal, abortController, paceAction } = ctx;
  const deps = { jobs, sessions, jobMachine, tenders, classifications, signal: abortController.signal, paceAction, portalHomeUrl: portal.url };
  const page = ctx.page!;
  const searchResult = await runSearchPhase(
    { ...deps, searches, onCategoryList: (categories) => portalCategories.save(portal.id, categories) },
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
  if (searchResult.outcome !== 'SUCCESS') return { result: searchResult, selected: { shortlisted: 0, needsReview: 0 } };

  // Earlier favourites of this date never decided from their details page
  // (they no longer show in search) are checked in My Tenders with this run.
  carryOverUndecidedFavourites(jobId, portal.id, ctx.checkAllUndecided ? null : config.searchDate);
  ctx.checkAllUndecided = false;

  const classificationResult = await runClassificationPhase(
    {
      ...deps,
      saveDocuments: (tender, detailPage) => saveTenderDocuments(ctx, jobId, config, tender, detailPage),
      askOperator: (tender, _detail, reason) => askOperatorDuringRun(ctx, jobId, tender, reason),
      // The same rule that picks the tenders this run collects.
      wantsDocuments: (tenderId) => selectionFor(jobId).includes(tenderId),
    },
    page, jobId, authSessionId, config, emitJobUpdate, portal.stateName
  );
  syncOpportunities('classification', () => syncJobOpportunities(opportunitySync, jobId, portal.id, { screening: classificationResult.outcome === 'SUCCESS' }));
  if (classificationResult.outcome !== 'SUCCESS') return { result: classificationResult, selected: { shortlisted: 0, needsReview: 0 } };

  // No pause for the operator: shortlisted and needs-review tenders are
  // downloaded in this signed-in session, and decided later in the Inbox.
  const selected = selectAutomatically(jobId);
  const result = await collectDocuments(ctx, jobId, authSessionId, selected);
  return { result, selected: countFound(jobId) };
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
  // The first date of the session also clears every undecided favourite in My Tenders.
  ctx.checkAllUndecided = true;
  activeBatch = batch;
  const collected: CollectedCounts = { shortlisted: 0, needsReview: 0 };
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
        statusMessage: `${runFinishedMessage(collected, batch.done.length)}${skippedNote ? ` ${skippedNote}` : ''}`,
      });
      // The operator may browse the portal while deciding.
      portalHost?.setAutomationPopups(false);
      const more = await waitForMoreDates(ctx.abortController.signal);
      portalHost?.setAutomationPopups(true);
      if (ctx.abortController.signal.aborted) return;
      if (!more) {
        emitJobUpdate({ ...lastResult!, awaitingMoreDates: false, outcome: 'SUCCESS', statusMessage: runFinishedMessage(collected, batch.done.length) });
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
    collected.shortlisted += selected.shortlisted;
    collected.needsReview += selected.needsReview;
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

/**
 * Approved tenders whose documents are not saved yet. The ones in My Tenders
 * can be opened by a documents run; a tender a finished documents run already
 * opened, with nothing left failing, has no files on its page and is done.
 */
function approvedWaitingForDocuments(portalId: string): { ready: TenderRow[]; notInMyTenders: TenderRow[] } {
  const opened = new Map<string, string>();
  for (const job of jobs.listAll()) {
    if (job.purpose !== 'DOCUMENTS' || job.state !== 'COMPLETE') continue;
    for (const id of jobs.documentTenderIds(job)) opened.set(id, job.created_at);
  }
  const ready: TenderRow[] = [];
  const notInMyTenders: TenderRow[] = [];
  for (const opportunity of opportunities.list({ lifecycles: ['APPROVED'], portalId })) {
    const rows = tenders.listForOpportunity(opportunity.id);
    if (rows.length === 0) continue;
    const favourite = [...rows].reverse().find((tender) => tender.favorited === 1);
    if (!favourite) {
      notInMyTenders.push(rows[rows.length - 1]);
      continue;
    }
    const openedAt = opened.get(favourite.id);
    const unfinished = workflow.listDocuments(favourite.id).some((document) => document.state !== 'DOWNLOADED');
    if (openedAt && favourite.detail_reviewed_at && favourite.detail_reviewed_at >= openedAt && !unfinished) continue;
    ready.push(favourite);
  }
  return { ready, notInMyTenders };
}

/** A job for one GeM date. GeM needs no sign-in, so the job is ready to search at once. */
function startGemDateJob(ctx: RunContext, searchDate: string): string {
  const job = jobs.create();
  jobMachine.transition(job.id, 'AUTH_REQUIRED', `GeM search for ${searchDate}`);
  jobMachine.transition(job.id, 'AUTH_PENDING', 'GeM needs no sign-in');
  jobMachine.transition(job.id, 'AUTHENTICATED', 'GeM bid list is public');
  runConfigurations.saveForJob(job.id, { ...ctx.config, searchDate });
  ctx.jobId = job.id;
  activeJobId = job.id;
  return job.id;
}

/**
 * Runs each GeM date as its own job: find the bids that started that day,
 * decide them, and save the kept ones' files. With no sign-in to keep, the
 * run simply finishes after the last date.
 */
async function runGemDates(ctx: RunContext, plan: DateBatchPlan, onStarted: (jobId: string) => void): Promise<void> {
  const signal = ctx.abortController.signal;
  const includeProducts = runConfigurations.getDefaults().gemIncludeProducts;
  const categoryCodes = await gemCategoryCodes(ctx.portal);
  let batch = { dates: [...plan.toRun], done: [] as string[], skipped: [...plan.skipped] };
  activeBatch = batch;
  const collected: CollectedCounts = { shortlisted: 0, needsReview: 0 };
  let last: AuthJobUpdate | undefined;
  for (let index = 0; index < plan.toRun.length; index += 1) {
    if (signal.aborted) return;
    const date = plan.toRun[index];
    activeSearchDate = date;
    const jobId = startGemDateJob(ctx, date);
    if (index === 0) onStarted(jobId);
    const config = runConfigurations.getForJob(jobId)!;
    ctx.config = config;
    const decided = await runGemDate({
      jobs, jobMachine, searches, tenders, classifications, client: ctx.gem!, includeProducts, categoryCodes, signal,
      askOperator: (tender, reason, documentUrl) => askOperatorDuringRun(ctx, jobId, tender, reason, documentUrl),
    }, jobId, config, emitJobUpdate);
    syncOpportunities('classification', () => syncJobOpportunities(opportunitySync, jobId, ctx.portal.id, { screening: decided.outcome === 'SUCCESS' }));
    let result = decided;
    let selected: CollectedCounts = { shortlisted: 0, needsReview: 0 };
    if (decided.outcome === 'SUCCESS') {
      const selection = selectAutomatically(jobId);
      result = await collectDocuments(ctx, jobId, '', selection);
      selected = countFound(jobId);
    }
    if (result.outcome !== 'SUCCESS') {
      const remaining = plan.toRun.slice(index + 1);
      if (remaining.length > 0 && !signal.aborted) {
        emitJobUpdate({
          ...result,
          outcome: result.outcome ?? 'ABORTED',
          abortReason: `${result.abortReason ?? `The run for ${date} did not finish.`} These dates were not run: ${remaining.join(', ')}. Start the same range again to run them; finished dates are skipped.`,
        });
      }
      return;
    }
    collected.shortlisted += selected.shortlisted;
    collected.needsReview += selected.needsReview;
    batch = { ...batch, done: [...batch.done, date] };
    activeBatch = batch;
    last = result;
  }
  if (!last) return;
  const skippedNote = describeSkipped(batch.skipped);
  emitJobUpdate({
    ...last,
    outcome: 'SUCCESS',
    phase: 'PUBLISHING',
    statusMessage: `${runFinishedMessage(collected, batch.done.length)}${skippedNote ? ` ${skippedNote}` : ''}`,
  });
}

/** Approved GeM tenders whose files are not all saved yet. */
function gemApprovedWaitingForDocuments(portalId: string): TenderRow[] {
  const waiting: TenderRow[] = [];
  for (const opportunity of opportunities.list({ lifecycles: ['APPROVED'], portalId })) {
    const latest = tenders.listForOpportunity(opportunity.id).at(-1);
    if (!latest) continue;
    let links: unknown[] = [];
    try { links = JSON.parse(latest.document_links_json) as unknown[]; } catch { links = []; }
    const documents = workflow.listDocuments(latest.id);
    const saved = documents.filter((document) => document.state === 'DOWNLOADED').length;
    if (links.length === 0 || saved < links.length) waiting.push(latest);
  }
  return waiting;
}

/**
 * Saves the files of approved GeM tenders into the folders their search gave
 * them. A tender never read (rejected on its category, then approved) has its
 * bid PDF read first, to find its attachments.
 */
async function collectGemApprovedDocuments(ctx: RunContext, jobId: string, targets: TenderRow[]): Promise<void> {
  const signal = ctx.abortController.signal;
  const update = (extra: Partial<AuthJobUpdate> = {}): AuthJobUpdate => ({
    jobId, authSessionId: '', authState: 'NOT_STARTED', jobState: jobs.getById(jobId)!.state, phase: 'ACQUISITION', ...extra,
  });
  const count = `${targets.length} approved ${targets.length === 1 ? 'tender' : 'tenders'}`;
  try {
    jobMachine.transition(jobId, 'ACQUIRING_DOCUMENTS', 'collecting the documents of approved GeM tenders');
    for (let index = 0; index < targets.length; index += 1) {
      if (signal.aborted) throw new Error(USER_CANCELLED_REASON);
      let tender = tenders.getById(targets[index].id) ?? targets[index];
      emitJobUpdate(update({ statusMessage: `Saving the files of ${tender.title} (${index + 1} of ${targets.length}).` }));
      if (tender.document_links_json === '[]' || !tender.detail_reviewed_at) {
        await readGemBidDetails({ client: ctx.gem!, tenders, retry: (task) => retryTransient(task, { delaysMs: GEM_RETRY_DELAYS_MS, signal }) }, tender.id, bidFromTender(tender));
        tender = tenders.getById(tender.id) ?? tender;
      }
      const source = runConfigurations.getForJob(tender.job_id) ?? ctx.config;
      const plan = jobOutputs.getOrCreatePlan(tender.job_id, ctx.outputSettings.localOutputRoot, source.searchDate, ctx.outputSettings.structure);
      const folder = tenderDocumentsDirectory(plan.jobDirectory, tender, jobOutputs.serialNumberFor(plan, tender.id), plan.structure, plan.outputDate);
      await saveTenderFiles(workflow, tender, folder, ctx.downloader!, signal);
    }
    for (const sourceJob of new Set(targets.map((tender) => tender.job_id))) {
      syncOpportunities('documents', () => recordCollectedDocuments(opportunitySync, sourceJob));
    }
    reportDriveProblems(copyApprovedTendersToDrive(targets.map((tender) => tenders.getById(tender.id) ?? tender)));
    // Their files are saved now, so Drive gets them too.
    uploadSavedTendersToGoogleDrive(targets.map((tender) => tenders.getById(tender.id) ?? tender));
    for (const [state, reason] of [
      ['DOCUMENTS_LOCAL', 'approved GeM tenders\' files saved locally'],
      ['PROCESSING_DOCUMENTS', 'documents run finishing'],
      ['EXTRACTING_REQUIREMENTS', 'no requirement extraction in a documents run'],
      ['UPLOADING', 'approved tenders copied to Drive'],
      ['REPORTING', 'documents run reporting'],
      ['COMPLETE', 'documents run complete'],
    ] as const) jobMachine.transition(jobId, state, reason);
    const saved = targets.filter((tender) => workflow.listDocuments(tender.id).some((document) => document.state === 'DOWNLOADED')).length;
    emitJobUpdate(update({ jobState: 'COMPLETE', phase: 'PUBLISHING', outcome: 'SUCCESS', statusMessage: `Files saved for ${saved} of ${count}.` }));
  } catch (error) {
    if (signal.aborted) {
      markJobCancelled(jobs, jobMachine, jobId);
      emitJobUpdate(update({ jobState: jobs.getById(jobId)!.state, outcome: 'ABORTED', abortReason: USER_CANCELLED_REASON }));
      return;
    }
    endJob(jobId, 'GeM documents run failed');
    emitJobUpdate(update({ jobState: jobs.getById(jobId)!.state, outcome: 'ABORTED', abortReason: error instanceof Error ? error.message : String(error) }));
  }
}

ipcMain.handle('get-documents-waiting', (_event, portalId: unknown): DocumentsWaiting => {
  const portal = getPortalDefinition(typeof portalId === 'string' ? portalId : DEFAULT_PORTAL_ID);
  if (isGemPortal(portal)) return { ready: gemApprovedWaitingForDocuments(portal.id).length, notInMyTenders: [] };
  const waiting = approvedWaitingForDocuments(portal.id);
  return {
    ready: waiting.ready.length,
    notInMyTenders: waiting.notInMyTenders.map((tender) => ({
      opportunityId: tender.opportunity_id ?? tender.id,
      title: tender.title,
      foundOnDate: runConfigurations.getForJob(tender.job_id)?.searchDate ?? null,
    })),
  };
});

/**
 * Opens each approved tender from My Tenders, reads its details again, and
 * saves its documents and zip into the folder its search gave it. Nothing is
 * searched or screened again.
 */
async function collectApprovedDocuments(ctx: RunContext, jobId: string, authSessionId: string, targets: TenderRow[]): Promise<void> {
  const signal = ctx.abortController.signal;
  const update = (extra: Partial<AuthJobUpdate> = {}): AuthJobUpdate => ({
    jobId, authSessionId,
    jobState: jobs.getById(jobId)!.state,
    authState: sessions.getById(authSessionId)?.state ?? 'AUTHENTICATED',
    phase: 'ACQUISITION',
    ...extra,
  });
  const count = `${targets.length} approved ${targets.length === 1 ? 'tender' : 'tenders'}`;
  try {
    jobMachine.transition(jobId, 'ACQUIRING_DOCUMENTS', 'collecting the documents of approved tenders');
    emitJobUpdate(update({ statusMessage: `Opening My Tenders to collect the documents of ${count}.` }));
    await retryTransient(() => navigateToMyTenders(ctx.page!, ctx.paceAction, ctx.portal.url), {
      signal,
      canRetry: () => !sessionWasLost(authSessionId),
    });
    let opened = 0;
    const batch = await reviewTendersFromMyTenders(ctx.page!, targets, 100, ctx.paceAction, async (tender, detail, detailPage) => {
      if (signal.aborted) return;
      opened += 1;
      emitJobUpdate(update({ statusMessage: `Saving the documents and zip file of ${tender.title} (${opened} of ${targets.length}).` }));
      tenders.updateDetail(tender.id, {
        organisationChain: detail.organisationChain,
        department: detail.department ?? undefined,
        stateName: detail.stateName ?? undefined,
        publishedDate: (detail.publishedDateRaw ? parseTenderPortalDate(detail.publishedDateRaw) : null) ?? tender.published_date,
        productCategory: detail.productCategories[0] ?? tender.detail_product_category ?? tender.product_category,
        tenderCategory: detail.tenderCategory,
        detailText: detailTextFor(detail),
        documentLinks: detail.documentLinks,
      });
      const config = runConfigurations.getForJob(tender.job_id) ?? ctx.config;
      // A failed file is recorded as not saved; the next documents run tries it again.
      await saveTenderDocuments(ctx, tender.job_id, config, tender, detailPage).catch(() => {});
    }, ctx.portal.url);
    if (signal.aborted) throw new Error(USER_CANCELLED_REASON);
    for (const sourceJob of new Set(targets.map((tender) => tender.job_id))) {
      syncOpportunities('documents', () => recordCollectedDocuments(opportunitySync, sourceJob));
    }
    // Approved tenders go to Drive once their files are saved.
    reportDriveProblems(copyApprovedTendersToDrive(targets));
    // Their files are saved now, so Drive gets them too.
    uploadSavedTendersToGoogleDrive(targets);
    if (sessionWasLost(authSessionId)) {
      endJob(jobId, 'portal signed out while collecting approved tenders\' documents');
      emitJobUpdate(update({
        jobState: jobs.getById(jobId)!.state, outcome: 'ABORTED',
        abortReason: 'The website signed you out part-way. Files already saved are kept; collect documents again to finish the rest.',
      }));
      return;
    }
    for (const [state, reason] of [
      ['DOCUMENTS_LOCAL', 'approved tenders\' documents saved locally'],
      ['PROCESSING_DOCUMENTS', 'documents run finishing'],
      ['EXTRACTING_REQUIREMENTS', 'no requirement extraction in a documents run'],
      ['UPLOADING', 'approved tenders copied to Drive'],
      ['REPORTING', 'documents run reporting'],
      ['COMPLETE', 'documents run complete'],
    ] as const) jobMachine.transition(jobId, state, reason);
    const saved = targets.filter((tender) => workflow.listDocuments(tender.id).some((document) => document.state === 'DOWNLOADED')).length;
    const missing = targets.length - batch.reviewed.size;
    emitJobUpdate(update({
      jobState: 'COMPLETE', phase: 'PUBLISHING', outcome: 'SUCCESS',
      statusMessage: `Documents saved for ${saved} of ${count}.${missing > 0 ? ` ${missing} could not be found in My Tenders.` : ''}`,
    }));
  } catch (error) {
    if (signal.aborted) {
      markJobCancelled(jobs, jobMachine, jobId);
      emitJobUpdate(update({ jobState: jobs.getById(jobId)!.state, outcome: 'ABORTED', abortReason: USER_CANCELLED_REASON }));
      return;
    }
    endJob(jobId, 'documents run failed');
    emitJobUpdate(update({ jobState: jobs.getById(jobId)!.state, outcome: 'ABORTED', abortReason: error instanceof Error ? error.message : String(error) }));
  }
}

/** GeM's documents run: no sign-in, files saved straight from GeM. */
async function startGemDocumentRun(portal: PortalDefinition): Promise<{ jobId: string; count: number }> {
  const { abortController, paceAction } = claimRun();
  let ctx: RunContext;
  let targets: TenderRow[];
  try {
    targets = gemApprovedWaitingForDocuments(portal.id);
    if (targets.length === 0) throw new Error('No approved GeM tender is waiting for its files.');
    const outputSettings = publishingSettings.get(portal.id);
    const config: RunConfiguration = { ...runConfigurations.getDefaults(), portalId: portal.id, searchDate: new Date().toLocaleDateString('en-CA') };
    const gem = gemClientFor(abortController.signal);
    ctx = { portal, config, outputSettings, abortController, paceAction, gem, downloader: gemDownloader(gem, abortController.signal) };
    activeRunPortalId = portal.id;
    await checkReadiness(portal, outputSettings);
  } catch (error) {
    releaseRun(abortController);
    throw error;
  }
  const job = jobs.create();
  jobs.markDocumentRun(job.id, targets.map((tender) => tender.id));
  jobMachine.transition(job.id, 'AUTH_REQUIRED', 'GeM documents run');
  jobMachine.transition(job.id, 'AUTH_PENDING', 'GeM needs no sign-in');
  jobMachine.transition(job.id, 'AUTHENTICATED', 'GeM files are public');
  activeJobId = job.id;
  ctx.jobId = job.id;
  activeJobCompletion = finishRun(ctx, collectGemApprovedDocuments(ctx, job.id, targets), () => {});
  return { jobId: job.id, count: targets.length };
}

ipcMain.handle('start-document-run', async (_event, portalId: unknown) => {
  const requested = getPortalDefinition(typeof portalId === 'string' ? portalId : DEFAULT_PORTAL_ID);
  if (isGemPortal(requested)) return startGemDocumentRun(requested);
  const { abortController, paceAction } = claimRun();
  let ctx: RunContext;
  let targets: TenderRow[];
  let credentials: PortalCredentials | undefined;
  try {
    const portal = getPortalDefinition(typeof portalId === 'string' ? portalId : DEFAULT_PORTAL_ID);
    targets = approvedWaitingForDocuments(portal.id).ready;
    if (targets.length === 0) throw new Error('No approved tender in My Tenders is waiting for its documents.');
    const outputSettings = publishingSettings.get(portal.id);
    const config: RunConfiguration = { ...runConfigurations.getDefaults(), portalId: portal.id, searchDate: new Date().toLocaleDateString('en-CA') };
    ctx = { portal, config, outputSettings, abortController, paceAction };
    activeRunPortalId = portal.id;
    await checkReadiness(portal, outputSettings);
    credentials = await loadPortalCredentials(portal.id);
    await openPortal(portal);
  } catch (error) {
    portalHost?.close();
    releaseRun(abortController);
    throw error;
  }

  let resolveStarted!: (jobId: string) => void;
  let rejectStarted!: (err: unknown) => void;
  const started = new Promise<string>((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
  let captured = false;
  const run = signIn(ctx, credentials, (signInUpdate) => {
    if (!captured) {
      captured = true;
      jobs.markDocumentRun(signInUpdate.jobId, targets.map((tender) => tender.id));
      activeJobId = signInUpdate.jobId;
      ctx.jobId = signInUpdate.jobId;
      resolveStarted(signInUpdate.jobId);
    }
    emitJobUpdate(signInUpdate);
  }).then(async (signedIn) => {
    if (signedIn.outcome !== 'SUCCESS' || !ctx.page) return;
    await collectApprovedDocuments(ctx, signedIn.jobId, signedIn.authSessionId, targets);
  });
  activeJobCompletion = finishRun(ctx, run, rejectStarted);
  return { jobId: await started, count: targets.length };
});

ipcMain.handle('start-job', async (_event, requestedConfig: RunConfiguration, untilDate?: unknown, options?: { runAgain?: unknown }) => {
  const { abortController, paceAction } = claimRun();
  let ctx: RunContext;
  let plan: DateBatchPlan;
  let savedPortalCredentials: PortalCredentials | undefined;
  try {
    const config = normalizeRunConfiguration(requestedConfig);
    const portal = getPortalDefinition(config.portalId);
    config.portalId = portal.id;
    plan = planDatesToRun(
      portal.id,
      config.searchDate,
      typeof untilDate === 'string' && untilDate ? untilDate : config.searchDate,
      options?.runAgain === true
    );
    config.searchDate = plan.toRun[0];
    const outputSettings = publishingSettings.get(portal.id);
    ctx = { portal, config, outputSettings, abortController, paceAction };
    activeRunPortalId = portal.id;
    activeSearchDate = config.searchDate;
    await checkReadiness(portal, outputSettings);
    if (!runConfigurations.hasSavedDefaults()) {
      throw new Error('Save your product categories and intent in Settings before starting a job.');
    }
    // Each website searches its own chosen categories.
    ctx.config = { ...config, productCategories: categoriesForPortal(runConfigurations.getDefaults(), portal) };
    if (isGemPortal(portal)) {
      // No portal window or sign-in for GeM.
      ctx.gem = gemClientFor(abortController.signal);
      ctx.downloader = gemDownloader(ctx.gem, abortController.signal);
    } else {
      savedPortalCredentials = await loadPortalCredentials(portal.id);
      await openPortal(portal);
    }
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

  if (ctx.gem) {
    activeJobCompletion = finishRun(ctx, runGemDates(ctx, plan, resolveStarted), rejectStarted);
    return { jobId: await started, dates: plan.toRun, skipped: plan.skipped };
  }

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
function planDatesToRun(portalId: string, from: string, to: string, runAgain = false): DateBatchPlan {
  // Run again: search dates already run too, e.g. after the screening improved.
  const plan = planDateBatch(from, to, runAgain ? [] : runConfigurations.listCompletedRunDates(portalId));
  if (plan.toRun.length === 0) {
    throw new Error(from === to
      ? `${from} already has a completed run for this portal. Its tenders are in the Inbox and Tenders pages.`
      : `Every date from ${from} to ${to} already has a completed run for this portal. Tick "Run again" to search them again.`);
  }
  return plan;
}

ipcMain.handle('run-more-dates', (_event, from: unknown, to: unknown, options?: { runAgain?: unknown }): DateBatchPlan => {
  if (!pendingMoreDates || !activeRunPortalId) throw new Error('The run is not waiting for more dates.');
  if (typeof from !== 'string' || typeof to !== 'string') throw new Error('Choose the published dates to run.');
  // Dates already run in this sign-in are never run twice; with "Run
  // again", dates from earlier runs are searched again.
  const queued = activeBatch?.dates ?? [];
  const earlier = options?.runAgain === true ? [] : runConfigurations.listCompletedRunDates(activeRunPortalId);
  const plan = planDateBatch(from, to, [...earlier, ...queued]);
  if (plan.toRun.length === 0) {
    throw new Error(options?.runAgain === true
      ? 'Every date in that range already ran in this sign-in.'
      : 'Every date in that range has already been run. Tick "Run again" to search them again.');
  }
  pendingMoreDates(plan);
  return plan;
});

ipcMain.handle('answer-run-question', (_event, questionId: unknown, answer: unknown): void => {
  if (!activeQuestion || !pendingAnswer || questionId !== activeQuestion.id) throw new Error('That question has already closed.');
  if (answer !== 'KEEP' && answer !== 'SKIP') throw new Error('Answer keep or skip.');
  pendingAnswer(answer);
});

ipcMain.handle('open-question-document', async (_event, questionId: unknown): Promise<void> => {
  // Only the open question's own GeM document, never a URL the page chose.
  const url = activeQuestion?.id === questionId ? activeQuestion?.documentUrl : undefined;
  if (!url || !/^https:\/\/bidplus\.gem\.gov\.in\/(?:showbidDocument|showradocumentPdf|showdirectradocumentPdf)\/\d+$/.test(url)) {
    throw new Error('That document can no longer be opened.');
  }
  await shell.openExternal(url);
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
  if (isGemPortal(portal)) {
    ctx.gem = gemClientFor(abortController.signal);
    ctx.downloader = gemDownloader(ctx.gem, abortController.signal);
  }
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
    if (plan.kind === 'SELECT_TENDERS' && ctx.gem) {
      // GeM files are public: no sign-in before saving them.
      const selected = selectAutomatically(jobId);
      const collected = await collectDocuments(ctx, jobId, '', selected);
      if (collected.outcome === 'SUCCESS') emitJobUpdate({ ...collected, phase: 'PUBLISHING', statusMessage: runFinishedMessage(countFound(jobId)) });
      return;
    }
    if (plan.kind === 'SELECT_TENDERS') {
      // Sign in first so the downloads run in that session.
      await openPortal(portal);
      const credentials = await loadPortalCredentials(portal.id).catch(() => undefined);
      const signedIn = await signIn(ctx, credentials, emitJobUpdate, jobId);
      if (signedIn.outcome !== 'SUCCESS') return;
      const selected = selectAutomatically(jobId);
      const collected = await collectDocuments(ctx, jobId, signedIn.authSessionId, selected);
      if (collected.outcome === 'SUCCESS') emitJobUpdate({ ...collected, statusMessage: runFinishedMessage(countFound(jobId)) });
      return;
    }
    // Documents already chosen: saved files need no portal, and collection
    // asks for sign-in as soon as something still has to be downloaded.
    prepareForDocumentCollection(jobs, jobMachine, jobId);
    const collected = await collectDocuments(ctx, jobId, latestSession?.id ?? '', plan.selectedTenderIds);
    if (collected.outcome === 'SUCCESS') emitJobUpdate({ ...collected, statusMessage: runFinishedMessage(countFound(jobId)) });
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
