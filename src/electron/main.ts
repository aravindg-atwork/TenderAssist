// src/electron/main.ts
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, safeStorage, shell, type MenuItemConstructorOptions } from 'electron';
import { basename, join, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
import { TenderWorkflowRepository, type ManualTenderDecision, type TenderReviewRow } from '../persistence/repositories/tenderWorkflowRepository.js';
import { JobOutputRepository } from '../persistence/repositories/jobOutputRepository.js';
import { OpportunityRepository, type OpportunityRow } from '../persistence/repositories/opportunityRepository.js';
import { applyTenderDecision, linkAllPossibleRetenders, recordCollectedDocuments, recordPageCorrigenda, syncJobOpportunities, syncTenderSighting } from '../orchestration/opportunitySync.js';
import { automaticDownloadSelection } from '../orchestration/automaticSelection.js';
import { describeSkipped, planDateBatch, type DateBatchPlan } from '../orchestration/dateBatch.js';
import { buildInbox, summarizeTender, type InboxView, type TenderSummary } from '../review/inbox.js';
import { cleanRequirement, keyFactsFrom, parseDetailFields, type TenderFileView } from '../review/tenderFile.js';
import { buildTenders, type TendersView } from '../review/tenders.js';
import { describeTimeline, type TimelineEntry } from '../review/timeline.js';
import { explainScreening, parseScreenedGates } from '../review/tenderExplanation.js';
import { buildDailyReport, type ReportRun, type ReportTender } from '../review/dailyReport.js';
import { DailyCountRepository } from '../persistence/repositories/dailyCountRepository.js';
import { countPublishedTenders } from '../portal/publicTenderCounts.js';
import { collectAuditHistory, writeAuditWorkbook } from '../review/auditHistory.js';
import type { OperatorDecision, OpportunityLifecycle } from '../state/opportunityLifecycle.js';
import { canTransition } from '../state/opportunityLifecycle.js';
import { JobStateMachine } from '../state/jobStateMachine.js';
import { AuthStateMachine } from '../state/authStateMachine.js';
import { getDatabasePath, getAppDataDir } from '../config/paths.js';
import { buildIdentity } from '../config/buildChannel.js';
import { waitForCdpReady } from '../browser/chromeLauncher.js';
import { runAuthJob } from '../orchestration/authJobRunner.js';
import { runSearchPhase } from '../orchestration/searchPhaseRunner.js';
import { suggestWords, workDescriptionFrom, type DecidedTenderText, type WordSuggestions } from '../review/wordSuggestions.js';
import { RUN_QUESTION_TIMEOUT_MS, waitForAnswer, withRunState, type RunQuestion, type RunQuestionAnswer } from '../orchestration/runQuestion.js';
import { runClassificationPhase } from '../orchestration/classificationPhaseRunner.js';
import { PORTAL_SESSION_EXPIRED_REASON, runPostProcessing, saveTenderFiles, type DocumentDownloader } from '../orchestration/postProcessingRunner.js';
import { GemClient } from '../gem/gemClient.js';
import { findBidsStartedOn } from '../gem/gemDaySearch.js';
import { bidDocumentUrl, portalStyleDate, type GemBid } from '../gem/gemBid.js';
import { findBidsWithWords } from '../gem/gemWordSearch.js';
import { reviewForLifecycle } from '../review/reviewAlignment.js';
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
  SignerStatus,
  SetupChecklist,
  SetupStep,
  LiveSessionTender,
  LiveSessionView,
  DailyReportView,
  ReportTenderItem,
  GemCategoryCounts,
  GemSearchWordPreview,
} from './ipcTypes.js';
import {
  categoriesForPortal, DEFAULT_GEM_CATEGORIES, normalizeRunConfiguration, STARTING_EXCLUDED_WORDS, STARTING_INTENT_WORDS, STARTING_PORTAL_CATEGORIES,
  type RunConfiguration, type RunDateMeaning,
} from '../config/runConfiguration.js';
import { categoryHealth, gemCategoryKey, suggestReplacements, type CategoryEvidence, type CategoryHealth, type ReplacementAdvice } from '../config/categoryHealth.js';
import { typeAllAtOnce, typeLikeAPerson, type PortalCredentials } from '../browser/portalLoginController.js';
import { canReadDocument, documentsTextFor, readDocumentText, wordsFoundIn, type OcrEngine } from '../documents/documentText.js';
import { ocrImage, ocrPdfPages, windowsOcrAvailable } from '../documents/windowsOcr.js';
import { extractTenderRequirements } from '../extraction/requirementExtractor.js';
import { isValidJnlpFile, type DscJnlpArtifact } from '../browser/dscDownloadSecurity.js';
import { daySheetFileName, isDaySheet, mirrorReportSheetsToDrive, mirrorTenderFolderToDrive, publishJobWorkbook, tenderDocumentsDirectory, tenderOutputDirectory, type PublishableTender, type ReportSheetMode } from '../publishing/jobPublisher.js';
import { supersededRuns } from '../publishing/supersededRuns.js';
import { resolveOutputStructure } from '../publishing/outputStructure.js';
import { driveFolderLink, driveFolderNameParts, driveFolderPath, GoogleDriveClient, GoogleDriveError, parseGoogleClientFile, signInWithGoogle, type DriveCredentials, type GoogleSignIn } from '../publishing/googleDrive.js';
import { GoogleDriveSettingsRepository } from '../persistence/repositories/googleDriveSettingsRepository.js';
import { ReportSheetSettingsRepository } from '../persistence/repositories/reportSheetSettingsRepository.js';
import { SetupChecklistRepository } from '../persistence/repositories/setupChecklistRepository.js';
import type { JobOutputPlan } from '../persistence/repositories/jobOutputRepository.js';
import { detailTextFor, downloadCorrigendumDocuments, downloadDetailDocuments, navigateToMyTenders, reviewTendersFromMyTenders } from '../browser/myTendersController.js';
import { corrigendaSummary, isWatched, tenderPageFacts } from '../review/watchedTenders.js';
import { parseTenderPortalDate } from '../search/tenderDateParser.js';
import { retryTransient } from '../orchestration/transientRetry.js';
import { checkForUpdates, configureUpdates, disableUpdates, getUpdateStatus, restartToInstall } from './updateService.js';
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
import { portalLockState, type PortalLockState } from './portalLock.js';
import { CHECK_EVERY_MS } from '../licence/licence.js';
import { LicenceStore, pcIdentity } from '../licence/licenceClient.js';
import { fetchSharedCategories, reportCategoryList, sharedListToApply } from '../licence/sharedCategories.js';
import { LicenceManager, type LicenceView } from '../licence/licenceManager.js';
import { LICENCE_PUBLIC_KEY, LICENCE_SERVER_URL } from '../licence/licenceServer.js';

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
// The database and DSC downloads follow the same override, so a development
// copy never opens the installed app's database. Only path lookups see it:
// child processes (such as the DSC signer) keep the real APPDATA.
const dataPathEnv: NodeJS.ProcessEnv = !app.isPackaged && process.env.TENDERASSIST_USER_DATA
  ? { ...process.env, APPDATA: process.env.TENDERASSIST_USER_DATA }
  : process.env;

// The real app or the dev build ("TenderAssist Dev"), which keeps its own
// folders and never updates itself (src/config/buildChannel.ts).
const build = buildIdentity(JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { tenderassistChannel?: unknown });
const isDevBuild = build.channel === 'dev';
if (isDevBuild) disableUpdates('The dev build does not update itself. Install a newer dev build to try new work.');

// Claim the process lock before opening SQLite. A fast double-click can start
// two Electron main processes concurrently; the losing process must exit
// before it touches the shared WAL/SHM files.
const hasSingleInstanceLock = app.requestSingleInstanceLock();

// Windows ties the taskbar button to the installed shortcut (and its TA icon)
// by this ID; it must match the installer's appId (build.appId in package.json, or the dev build's).
if (process.platform === 'win32') app.setAppUserModelId(build.appUserModelId);

if (!hasSingleInstanceLock) {
  app.quit();
} else {
// A restore chosen in the previous session is swapped in before SQLite opens
// the database; the replaced database is kept beside it.
const migrationsDir = join(app.getAppPath(), 'src', 'persistence', 'migrations');
let restoredPreviousDatabase: string | null = null;
let restoreStartupError: string | null = null;
try {
  restoredPreviousDatabase = applyPendingRestore(getDatabasePath(dataPathEnv, build.folderName));
} catch (error) {
  restoreStartupError = error instanceof Error ? error.message : String(error);
}
const db = createDatabase(getDatabasePath(dataPathEnv, build.folderName));
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
const publishingSettings = new PublishingSettingsRepository(db, join(homedir(), 'Documents', build.folderName));
const automationSettings = new AutomationSettingsRepository(db);
const portalCategories = new PortalCategoryRepository(db);
const displaySettings = new DisplaySettingsRepository(db);
const jobOutputs = new JobOutputRepository(db);
const opportunities = new OpportunityRepository(db);
const googleDriveSettings = new GoogleDriveSettingsRepository(db);
const reportSheetSettings = new ReportSheetSettingsRepository(db);
const setupState = new SetupChecklistRepository(db);
const dailyCounts = new DailyCountRepository(db);
const opportunitySync = { tenders, classifications, opportunities, workflow };

// Tender records are a view over run data; a failure to update them must
// never fail the run itself, so report and carry on.
function syncOpportunities(label: string, fn: () => void): void {
  try { fn(); } catch (error) { console.error(`[TenderAssist] tender record sync failed (${label}):`, error); }
}
/**
 * Tender pages saved before closing dates and corrigenda were read from
 * them (before 9 Oct 2026). Filled in quietly: the operator saw those pages,
 * so nothing is shown as changed. Safe to repeat; known values are kept.
 */
function catchUpTenderPages(): void {
  for (const opportunity of opportunities.list()) {
    if (isGemPortal(getPortalDefinition(opportunity.portal_id))) continue;
    const pages = tenders.listForOpportunity(opportunity.id).filter((tender) => tender.detail_text);
    for (const tender of pages) {
      const { closingDateRaw } = tenderPageFacts(tender.detail_text);
      if (closingDateRaw) tenders.fillClosingDate(tender.id, closingDateRaw);
      recordPageCorrigenda(opportunitySync, opportunity.id, tender.detail_text, { jobId: tender.job_id, at: tender.detail_reviewed_at ?? undefined }, { flagDecided: false });
    }
    const closing = tenderPageFacts(pages.at(-1)?.detail_text).closingDateRaw;
    if (closing) opportunities.fillClosingDate(opportunity.id, closing);
  }
}
syncOpportunities('tender page catch-up', catchUpTenderPages);
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
/** The search run in progress, for "This search" in the run panel. */
let activeRunContext: RunContext | undefined;
// The "Keep or skip?" question on screen, and how to deliver its answer.
let activeQuestion: RunQuestion | undefined;
let pendingAnswer: ((answer: RunQuestionAnswer) => void) | undefined;
const dscDownloadDirectory = join(getAppDataDir(dataPathEnv, build.folderName), 'dsc-downloads');
// The licence key: enforced in installed builds (and in development with
// TENDERASSIST_LICENCE=on). See src/licence/ and docs/licence-setup.md.
const licenceStore = new LicenceStore(join(getAppDataDir(dataPathEnv, build.folderName), 'licence.json'));
const licence = new LicenceManager({
  store: licenceStore,
  appDataDir: getAppDataDir(dataPathEnv, build.folderName),
  serverUrl: LICENCE_SERVER_URL,
  publicKey: LICENCE_PUBLIC_KEY,
  version: app.getVersion(),
  enforced: app.isPackaged || process.env.TENDERASSIST_LICENCE === 'on',
  identity: pcIdentity,
  signIn: async () => {
    // The same sign-in allows Drive uploads; kept once the key server accepts it (activate-licence).
    const signIn = await googleSignIn();
    pendingLicenceSignIn = signIn;
    return signIn.idToken;
  },
});
// The licence sign-in waiting for the key server's answer; its Drive access is saved only for an accepted key.
let pendingLicenceSignIn: GoogleSignIn | null = null;
// claimRun() is synchronous, so it reads these; every licence change updates them.
let licenceUsable = false;
let licenceRefusal = 'TenderAssist is still checking its key. Try again in a moment.';
function noteLicence(view: LicenceView): LicenceView {
  licenceUsable = view.usable;
  licenceRefusal = `${view.message || 'TenderAssist needs a valid key.'} ${view.contact}`.trim();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('licence-changed', view);
  return view;
}
licence.onChange(noteLicence);
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

/** The sign-in step last announced, so the operator is called once per step. */
let announcedAuthStep: string | undefined;

/**
 * The CAPTCHA and the DSC PIN are the operator's to type. When the run
 * reaches either, the taskbar button flashes and Windows plays its alert
 * sound once, so the operator can come back to the window.
 */
function callOperatorForSignIn(update: AuthJobUpdate): void {
  const step = update.authStep;
  if (step === announcedAuthStep) return;
  announcedAuthStep = step;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (step === 'CAPTCHA_REQUIRED' || step === 'DSC_READY') {
    if (!mainWindow.isFocused()) mainWindow.flashFrame(true);
    shell.beep();
  } else {
    mainWindow.flashFrame(false);
  }
}

function emitJobUpdate(raw: AuthJobUpdate): void {
  const update: AuthJobUpdate = {
    ...(backgroundRun ? { background: true } : {}),
    dateMeaning: activeRunContext?.config.dateMeaning,
    closingFrom: activeRunContext?.config.closingFrom,
    ...withRunState(raw, { searchDate: activeSearchDate, batch: activeBatch, question: activeQuestion }),
  };
  callOperatorForSignIn(update);
  lastActiveJobUpdate = update;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('job-updated', update);
  applyPortalLock();
}

// While a run drives the portal, the operator's clicks are held back from it
// (see portalLock.ts) unless they chose to take control for this run.
let operatorTookControl = false;

function currentPortalLock(): PortalLockState {
  return portalLockState(activeJobId ? lastActiveJobUpdate : undefined, operatorTookControl);
}

function applyPortalLock(): void {
  const state = currentPortalLock();
  portalHost?.setLocked(state.locked);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('portal-lock', state);
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
    // Shown once the first frame is painted, on the app's own background: no white flash at start.
    show: false,
    backgroundColor: '#d6eaf5',
    // A modern frameless window: the app draws its own top bar; Windows keeps
    // its minimise / maximise / close buttons, drawn over the bar's colour.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#d6eaf5', symbolColor: '#364865', height: 44 },
    ...(app.isPackaged ? {} : { icon: join(__dirname, '..', '..', 'build', 'icon.png') }),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      additionalArguments: [`--tenderassist-channel=${build.channel}`],
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
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
    stageRestore(backupPath, getDatabasePath(dataPathEnv, build.folderName));
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
  // The sheets, downloads and counts follow this decision, not an earlier answer in a run.
  alignReviews(opportunityIds);
  if (decision === 'APPROVE') afterApproval(approvedTenderRowsFor(opportunityIds));
  else {
    // Any other decision (reject, back to review, later) rewrites the day's sheet (and its Drive copy) from the latest decisions too.
    const rows = opportunityIds.flatMap((id) => tenders.listForOpportunity(id));
    void refreshDaySheets(rows).then(() => { if (runsUploadToDrive()) uploadSavedTendersToGoogleDrive(rows); });
  }
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

/** Requirements found from the tender page and its documents, in plain names. */
function requirementFields(row: { data_json: string } | undefined): Array<{ label: string; value: string }> {
  if (!row) return [];
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(row.data_json) as Record<string, unknown>; } catch { return []; }
  const names: Array<[string, string]> = [['scope', 'Scope'], ['eligibility', 'Eligibility'], ['emd', 'EMD'], ['tenderFee', 'Tender fee'], ['submissionDeadline', 'Submission deadline'], ['contact', 'Contact']];
  return names.flatMap(([key, label]) => {
    const value = typeof data[key] === 'string' ? cleanRequirement(key, data[key] as string) : null;
    return value ? [{ label, value }] : [];
  });
}

ipcMain.handle('get-tender-file', (_event, opportunityId: unknown): TenderFileView => {
  if (typeof opportunityId !== 'string' || !opportunities.getById(opportunityId)) throw new Error('Tender not found.');
  const rows = [...tenders.listForOpportunity(opportunityId)].reverse();
  const read = rows.find((tender) => tender.detail_text);
  const allFields = parseDetailFields(read?.detail_text);
  const withDocuments = rows.find((tender) => workflow.listDocuments(tender.id).length > 0);
  const documentsRead = withDocuments ? workflow.listDocuments(withDocuments.id).some((document) => document.text_content) : false;
  const defaults = runConfigurations.getDefaults();
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
      read: document.text_read_at && document.text_method ? {
        method: document.text_method,
        pages: document.text_pages ?? 0,
        ocrPages: document.text_ocr_pages ?? 0,
        intentWords: wordsFoundIn(document.text_content ?? '', defaults.keywords),
        excludedWords: wordsFoundIn(document.text_content ?? '', defaults.excludedKeywords),
        // GeM's PDFs are in Hindi and English; the Hindi shows as boxes without its font, so the preview keeps the English.
        preview: (document.text_content ?? '').replace(/\[Page \d+\]/g, ' ').replace(/[^\x20-\x7E₹\s]/g, '').replace(/\s+/g, ' ').replace(/(?:\s*\/\/?\s*){2,}/g, ' / ').trim().slice(0, 280),
      } : null,
    })),
    hasFolder: tenderFolderFor(opportunityId) !== null,
    detailsRead: Boolean(read?.detail_reviewed_at),
    fromDocuments: documentsRead && withDocuments ? requirementFields(workflow.getRequirements(withDocuments.id)) : [],
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
    if (job.purpose === 'CHANGES') {
      return {
        jobId: job.id, jobState: job.state, authState: session?.state ?? null,
        createdAt: job.created_at, updatedAt: job.updated_at,
        portalId: config?.portalId ?? DEFAULT_PORTAL_ID, searchDate: null,
        tendersFound: changeCheckIds(job).length, kept: 0,
        purpose: 'CHANGES' as const,
      };
    }
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
      dateMeaning: config?.dateMeaning ?? 'PUBLISHED',
      closingFrom: config?.closingFrom,
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

/** Who this PC is to the key server, for the shared categories; null before activation. */
async function sharedCategoriesCaller(): Promise<{ serverUrl: string; key: string; pcId: string } | null> {
  const stored = licenceStore.read();
  if (!stored?.signed || !LICENCE_SERVER_URL) return null;
  return { serverUrl: LICENCE_SERVER_URL, key: stored.key, pcId: (await pcIdentity()).pcId };
}

/**
 * Saves a category list just read from the website and shares it with every
 * other TenderAssist through the key server (in the background; offline is fine).
 * The dev build only reads the shared lists: work being tested never reaches the offices.
 */
function rememberCategoryList(listId: string, names: string[], readAt = new Date().toISOString(), codes?: Record<string, string>): PortalCategoryList {
  const saved = portalCategories.save(listId, names, readAt, codes);
  if (isDevBuild) return saved;
  void sharedCategoriesCaller().then((caller) => caller && reportCategoryList(caller, listId, saved.categories, readAt, codes))
    .catch((error) => console.error('[TenderAssist] Could not share the category list:', error));
  return saved;
}

let pullingSharedCategories: Promise<void> | null = null;
let sharedCategoriesPulledAt = 0;

/**
 * Takes in the lists other offices read since this PC last read each website,
 * so a renamed or dropped category is known here the same day: Today warns
 * before Start, and Settings shows the new categories.
 */
function pullSharedCategories(minAgeMs = 0): Promise<void> {
  if (!pullingSharedCategories && Date.now() - sharedCategoriesPulledAt < minAgeMs) return Promise.resolve();
  pullingSharedCategories ??= (async () => {
    const caller = await sharedCategoriesCaller();
    const shared = caller ? await fetchSharedCategories(caller) : null;
    if (shared) sharedCategoriesPulledAt = Date.now();
    for (const [listId, list] of Object.entries(shared ?? {})) {
      const apply = sharedListToApply(portalCategories.get(listId), list);
      if (apply) portalCategories.save(listId, apply.names, apply.readAt, Object.keys(apply.codes).length ? apply.codes : undefined);
    }
  })().catch((error) => console.error('[TenderAssist] Could not read the shared categories:', error))
    .finally(() => { pullingSharedCategories = null; });
  return pullingSharedCategories;
}

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
      services = rememberCategoryList(portal.id, list.services.map((entry) => entry.name), readAt, codesOf(list.services));
      products = rememberCategoryList(productsKey, list.products.map((entry) => entry.name), readAt, codesOf(list.products));
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
  // Also by the category alone, as GeM's example after " - " changes (inChosenCategory looks it up that way).
  for (const [name, code] of Object.entries({ ...products.codes, ...services.codes })) {
    const key = `category:${gemCategoryKey(name)}`;
    if (!codes.has(key)) codes.set(key, code);
  }
  return codes;
}

/** A chosen GeM name's code: the exact entry, else the same category with another example (as `inChosenCategory`). */
function gemCodeFor(name: string, codes: ReadonlyMap<string, string>): string | undefined {
  return codes.get(name.replace(/\s+/g, ' ').trim().toLocaleLowerCase()) ?? codes.get(`category:${gemCategoryKey(name)}`);
}

const isGemProductCode = (code: string | undefined) => Boolean(code) && !code!.startsWith('services_');

// GeM's whole Category dropdown, services and products together, as GeM's own
// advanced search shows it; product bids are searched once a product category is chosen.
ipcMain.handle('get-portal-categories', async (_event, portalId: string): Promise<PortalCategoryList> => {
  const portal = getPortalDefinition(portalId);
  if (!isGemPortal(portal)) return portalCategories.get(portal.id);
  const { services, products } = await gemCategoryLists(portal);
  return {
    categories: [...services.categories, ...products.categories],
    readAt: services.readAt,
    productNames: products.categories,
  };
});

/** Open bids per GeM category, as GeM counts them; read at most every few hours per category. */
const GEM_OPEN_COUNT_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const gemOpenCounts = new Map<string, { count: number; at: number }>();
let gemCountClient: GemClient | null = null;
let gemCountQueue: Promise<unknown> = Promise.resolve();

/** Each category's bids in the GeM runs of the last 30 days, by the category before " - ". */
function recentGemCategoryCounts(portalId: string): { counts: Record<string, number>; days: number } {
  const to = new Date().toLocaleDateString('en-CA');
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 29);
  const counts: Record<string, number> = {};
  const rows = dailyCounts.list(portalId, fromDate.toLocaleDateString('en-CA'), to).filter((row) => row.source === 'GEM_LIST' && row.categories);
  for (const row of rows) {
    for (const [name, count] of Object.entries(row.categories!)) {
      const key = gemCategoryKey(name);
      counts[key] = (counts[key] ?? 0) + count;
    }
  }
  return { counts, days: rows.length };
}

ipcMain.handle('get-gem-category-counts', async (_event, portalId: unknown, names: unknown): Promise<GemCategoryCounts> => {
  const portal = getPortalDefinition(typeof portalId === 'string' ? portalId : '');
  if (!isGemPortal(portal)) throw new Error('Category counts are for GeM only.');
  const asked = Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string').slice(0, 60) : [];
  const codes = await gemCategoryCodes(portal);
  const recent = recentGemCategoryCounts(portal.id);
  // One question to GeM at a time, gently, however many pages ask.
  const open = await (gemCountQueue = gemCountQueue.catch(() => undefined).then(async () => {
    const result: Record<string, number | null> = {};
    for (const name of asked) {
      const code = gemCodeFor(name, codes);
      if (!code) { result[name] = null; continue; }
      const cached = gemOpenCounts.get(code);
      if (cached && Date.now() - cached.at < GEM_OPEN_COUNT_MAX_AGE_MS) { result[name] = cached.count; continue; }
      try {
        gemCountClient ??= new GemClient({ timeoutMs: 30_000, pause: () => new Promise((resolve) => setTimeout(resolve, 400)) });
        const count = await retryTransient(() => gemCountClient!.openBidCount(code), { delaysMs: [2_000, 5_000] });
        gemOpenCounts.set(code, { count, at: Date.now() });
        result[name] = count;
      } catch (error) {
        console.error('[TenderAssist] GeM open-bid count not read:', error);
        result[name] = null;
      }
    }
    return result;
  })) as Record<string, number | null>;
  const recentByName: Record<string, number> = {};
  for (const name of asked) recentByName[name] = recent.counts[gemCategoryKey(name)] ?? 0;
  return { open, recent: recentByName, recentDays: recent.days };
});

/**
 * What a GeM search word would bring, before it is saved: GeM's open bids
 * with it, after the whole-word check runs use (src/gem/gemWordSearch.ts).
 */
const GEM_WORD_PREVIEW_PAGES = 10;
ipcMain.handle('preview-gem-search-word', async (_event, word: unknown): Promise<GemSearchWordPreview> => {
  if (typeof word !== 'string' || !/[\p{L}\p{N}]{2}/u.test(word)) throw new Error('Type a word or phrase of two letters or more.');
  const phrase = word.trim().replace(/\s+/g, ' ');
  const portal = getPortalDefinition('gem');
  gemCountClient ??= new GemClient({ timeoutMs: 30_000, pause: () => new Promise((resolve) => setTimeout(resolve, 400)) });
  const client = gemCountClient;
  const result = await (gemCountQueue = gemCountQueue.catch(() => undefined).then(() => findBidsWithWords([phrase], ['service', 'product'],
    ({ keyword, bidType, page }) => retryTransient(() => client.listBids({ page, bidType, keyword }), { delaysMs: [2_000, 5_000] }),
    undefined, GEM_WORD_PREVIEW_PAGES))) as Awaited<ReturnType<typeof findBidsWithWords>>;
  const known = (bid: GemBid) => opportunities.findByIdentity(portal.id, OpportunityRepository.identityKey(bid.id, bid.bidNumber));
  const bids = result.hits
    .sort((a, b) => Number(b.visible) - Number(a.visible) || (b.bid.startsAt ?? '').localeCompare(a.bid.startsAt ?? ''))
    .map(({ bid, visible }) => ({
      bidNumber: bid.bidNumber, title: bid.title, category: bid.category, endsAt: bid.endsAt, visible,
      alreadySeen: Boolean(known(bid)), url: bidDocumentUrl(bid),
    }));
  return { word: phrase, bids, dropped: result.dropped, tooCommon: result.tooCommon.reduce((sum, entry) => sum + entry.total, 0) || null };
});

/** The website's list the chosen categories are checked against, with its history. */
async function categoryListForHealth(portal: PortalDefinition): Promise<PortalCategoryList> {
  if (!isGemPortal(portal)) return portalCategories.get(portal.id);
  const { services, products } = await gemCategoryLists(portal);
  return {
    ...services,
    categories: [...services.categories, ...products.categories],
    history: { ...products.history, ...services.history },
  };
}

ipcMain.handle('get-category-health', async (_event, portalId: string): Promise<CategoryHealth> => {
  // Before Start: take in category changes other offices saw today (never waits more than 5 seconds).
  await Promise.race([pullSharedCategories(10 * 60 * 1000), new Promise((resolveWait) => setTimeout(resolveWait, 5_000))]);
  const portal = getPortalDefinition(portalId);
  return categoryHealth(await categoryListForHealth(portal), categoriesForPortal(runConfigurations.getDefaults(), portal), new Date(), isGemPortal(portal) ? gemCategoryKey : undefined);
});

ipcMain.handle('suggest-category-replacements', async (_event, portalId: string, missingName: string): Promise<ReplacementAdvice> => {
  const portal = getPortalDefinition(portalId);
  if (typeof missingName !== 'string' || !missingName.trim()) throw new Error('Name the category to replace.');
  // Every tender this website gave before: where the office's kind of work was listed.
  const evidence: CategoryEvidence[] = jobs.listAll()
    .filter((job) => (runConfigurations.getForJob(job.id)?.portalId ?? DEFAULT_PORTAL_ID) === portal.id)
    .flatMap((job) => tenders.listForJob(job.id))
    .map((tender) => ({
      category: tender.product_category,
      detailCategory: tender.detail_product_category,
      wanted: isApprovedTender(tender) || (workflow.getReview(tender.id)?.decision ?? classifications.getFinalForTender(tender.id)) === 'KEEP',
    }));
  return suggestReplacements(await categoryListForHealth(portal), missingName, categoriesForPortal(runConfigurations.getDefaults(), portal), evidence);
});

ipcMain.handle('mark-new-categories-looked', (_event, portalId: string): void => {
  portalCategories.markNewLooked(getPortalDefinition(portalId).id);
});

ipcMain.handle('get-portal-credential-settings',async (_event, portalId: string): Promise<PortalCredentialSettings> => {
  return credentialSettings(getPortalDefinition(portalId).id);
});

ipcMain.handle('get-publishing-settings', (_event, portalId: string) => publishingSettings.get(getPortalDefinition(portalId).id));
ipcMain.handle('save-publishing-settings', (_event, portalId: string, settings) => publishingSettings.save(settings, getPortalDefinition(portalId).id));
ipcMain.handle('get-google-drive', () => googleDriveStatus());

ipcMain.handle('save-google-drive', async (_event, input: unknown): Promise<GoogleDriveStatus> => {
  const value = (input ?? {}) as { folderName?: unknown; uploadMode?: unknown };
  const current = googleDriveSettings.get();
  if (value.uploadMode === 'SAVED' || value.uploadMode === 'APPROVED') {
    googleDriveSettings.save({ ...current, uploadMode: value.uploadMode });
    if (typeof value.folderName !== 'string') return googleDriveStatus();
  }
  const folderName = driveFolderNameParts(typeof value.folderName === 'string' ? value.folderName : '').join('/');
  if (folderName === current.folderName) return googleDriveStatus();
  // A new name means a new folder: found (or made) in My Drive when signed in, otherwise at the first upload.
  googleDriveSettings.save({ ...googleDriveSettings.get(), folderName, folderId: '' });
  const client = await googleDriveClient();
  if (client && folderName) await driveFolderFor(client);
  return googleDriveStatus();
});

/** Signs in to Google again from Settings (when the licence sign-in was not kept, ended, or was removed). */
ipcMain.handle('connect-google-drive', async (): Promise<GoogleDriveStatus> => {
  await keepGoogleSignIn(await googleSignIn());
  return googleDriveStatus();
});

ipcMain.handle('check-google-drive', async (): Promise<GoogleDriveStatus> => {
  const client = await googleDriveClient();
  if (!client) throw new Error('Google Drive is not signed in yet.');
  const account = await client.account();
  googleDriveSettings.save({ ...googleDriveSettings.get(), accountEmail: account.email });
  if (googleDriveSettings.get().folderName) await driveFolderFor(client);
  return googleDriveStatus();
});

ipcMain.handle('get-report-sheets', (): ReportSheetMode => reportSheetSettings.get());

/** Changes how day sheets are split; every saved day is rewritten the new way (and Drive follows), in the background. */
ipcMain.handle('save-report-sheets', (_event, mode: unknown): ReportSheetMode => {
  const previous = reportSheetSettings.get();
  const saved = reportSheetSettings.save(mode === 'ONE_PER_DAY' ? 'ONE_PER_DAY' : 'PER_WEBSITE');
  if (saved !== previous) void rewriteAllDaySheets();
  return saved;
});

async function rewriteAllDaySheets(): Promise<void> {
  const days = new Map<string, string>();
  for (const job of jobs.listAll()) {
    const plan = jobOutputs.getPlan(job.id);
    if (plan && job.id !== activeJobId && existsSync(plan.jobDirectory)) days.set(resolve(plan.jobDirectory).toLocaleLowerCase(), job.id);
  }
  for (const jobId of days.values()) {
    try { await publishStoredJob(jobId); }
    catch (error) { console.error(`[TenderAssist] Could not rewrite the report sheets of run ${jobId}:`, error); }
  }
  const jobIds = [...days.values()];
  if (runsUploadToDrive() && jobIds.length > 0) void uploadToGoogleDrive([], jobIds.map((jobId) => ({ jobId })), 'report sheets upload');
}

ipcMain.handle('open-google-drive-folder', async (): Promise<void> => {
  const { folderId } = googleDriveSettings.get();
  if (!folderId) throw new Error('The Drive folder is made at the first upload. Run a search, or choose “Upload everything saved so far”.');
  await shell.openExternal(driveFolderLink(folderId));
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

const APPROVED_BY_OPERATOR = 'Approved by you';
const REJECTED_BY_OPERATOR = 'Rejected by you';

/**
 * Brings the review saved with a run's answer in line with the operator's
 * latest decision on these tenders (src/review/reviewAlignment.ts): approved
 * or rejected later, or taken back ("Back to review", "Later"). At start-up
 * only decisions are copied (`clearUndecided` false), so an answer whose
 * status could not be saved is never lost.
 */
function alignReviews(opportunityIds: readonly string[], clearUndecided = true): void {
  for (const id of opportunityIds) {
    const opportunity = opportunities.getById(id);
    if (!opportunity) continue;
    const wanted = reviewForLifecycle(opportunity.lifecycle);
    if (wanted === 'LEAVE') continue;
    for (const tender of tenders.listForOpportunity(id)) {
      const current = workflow.getReview(tender.id);
      if (wanted === null) {
        if (current && clearUndecided) workflow.clearReview(tender.id);
      } else if (current?.decision !== wanted) {
        workflow.saveReview(tender.id, wanted, wanted === 'KEEP' ? APPROVED_BY_OPERATOR : REJECTED_BY_OPERATOR);
      }
    }
  }
}

/** Decisions made before reviews followed them: line every saved review up with its tender's status, once at start-up. */
function alignAllReviews(): void {
  const rows = db.prepare(
    `SELECT DISTINCT t.opportunity_id AS id FROM tender_reviews r JOIN tenders t ON t.id = r.tender_id WHERE t.opportunity_id IS NOT NULL`,
  ).all() as Array<{ id: string }>;
  alignReviews(rows.map((row) => row.id), false);
}

/** The operator's own call on a tender (Approve or Reject on Today or Tenders), as a review row for the sheet. */
function operatorDecisionReview(tender: TenderRow): TenderReviewRow | undefined {
  const opportunity = tender.opportunity_id ? opportunities.getById(tender.opportunity_id) : undefined;
  if (!opportunity) return undefined;
  if (APPROVED_LIFECYCLES.includes(opportunity.lifecycle)) {
    return { tender_id: tender.id, decision: 'KEEP', reason: APPROVED_BY_OPERATOR, decided_at: '' };
  }
  if (opportunity.lifecycle === 'REJECTED') {
    return { tender_id: tender.id, decision: 'REJECT', reason: REJECTED_BY_OPERATOR, decided_at: '' };
  }
  return undefined;
}

/** The tenders of one run that belong on its day's sheet. */
function sheetItemsFor(jobId: string, plan: JobOutputPlan, portal: PortalDefinition): PublishableTender[] {
  const allItems = tenders.listForJob(jobId).filter((tender) => !isFiledElsewhere(tender) && !isReplacedByLaterSearch(tender)).map((tender) => ({
    tender,
    automaticDecision: classifications.getFinalForTender(tender.id),
    manualReview: workflow.getReview(tender.id) ?? operatorDecisionReview(tender),
    documents: workflow.listDocuments(tender.id),
    requirements: workflow.getRequirements(tender.id),
  }));
  // Tenders the operator approved (even long after the run) are always on the day's sheet.
  const explicitlyProcessed = allItems.filter((item) => item.requirements || item.documents.length > 0
    || (item.manualReview?.decision === 'KEEP' && item.manualReview.reason === APPROVED_BY_OPERATOR));
  const items = explicitlyProcessed.length > 0
    ? explicitlyProcessed
    : allItems.filter((item) => (item.manualReview?.decision ?? item.automaticDecision) === 'KEEP');
  return items.map((item) => ({ ...item, serialNumber: jobOutputs.serialNumberFor(plan, item.tender.id), portal: { url: portal.url, name: portal.name } }));
}

// Day folders whose sheets are being written, so two writes never cross.
const daySheetWrites = new Map<string, Promise<void>>();

/**
 * Writes the report sheets of a run's day folder. Every run saving into that
 * folder is on them: one sheet per website (Settings → Folders → Report
 * sheets), or one sheet for the whole day. Sheets under names no longer used
 * (an older "(run 2)" sheet, the other split) are removed.
 */
function publishStoredJob(jobId: string): Promise<void> {
  const config = runConfigurations.getForJob(jobId);
  if (!config) return Promise.reject(new Error('This job has no saved run configuration.'));
  const plan = outputPlanFor(jobId, config.portalId);
  const key = resolve(plan.jobDirectory).toLocaleLowerCase();
  const write = (daySheetWrites.get(key) ?? Promise.resolve()).catch(() => {}).then(() => publishDaySheets(plan));
  daySheetWrites.set(key, write);
  return write;
}

async function publishDaySheets(plan: JobOutputPlan): Promise<void> {
  const mode = reportSheetSettings.get();
  const baseName = resolveOutputStructure(plan.structure, plan.outputDate).approvedWorkbook;
  const sheets = new Map<string, { items: PublishableTender[]; portal: PortalDefinition; jobId: string }>();
  for (const jobId of jobOutputs.jobsInDirectory(plan.jobDirectory)) {
    const config = runConfigurations.getForJob(jobId);
    const jobPlan = jobOutputs.getPlan(jobId);
    if (!config || !jobPlan) continue;
    const portal = getPortalDefinition(config.portalId);
    const fileName = daySheetFileName(baseName, mode, portal.name);
    const sheet = sheets.get(fileName) ?? { items: [], portal, jobId };
    sheet.items.push(...sheetItemsFor(jobId, jobPlan, portal));
    sheets.set(fileName, sheet);
  }
  for (const [fileName, sheet] of sheets) {
    const items = [...sheet.items].sort((a, b) => (a.serialNumber ?? 0) - (b.serialNumber ?? 0));
    await publishJobWorkbook(plan.outputRoot, plan.outputDate, sheet.jobId, items, plan.structure, 1, { url: sheet.portal.url, name: sheet.portal.name }, fileName);
  }
  const written = new Set([...sheets.keys()].map((name) => name.toLocaleLowerCase()));
  for (const name of existsSync(plan.jobDirectory) ? readdirSync(plan.jobDirectory) : []) {
    if (isDaySheet(baseName, name) && !written.has(name.toLocaleLowerCase())) {
      try { rmSync(join(plan.jobDirectory, name), { force: true }); }
      catch (error) { console.error(`[TenderAssist] Could not remove the old report sheet ${name}:`, error); }
    }
  }
  await binReplacedTenderFolders(plan.jobDirectory);
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

ipcMain.handle('get-licence', async (): Promise<LicenceView> => noteLicence(await licence.view()));
ipcMain.handle('activate-licence', async (_event, key: unknown): Promise<LicenceView> => {
  if (typeof key !== 'string') throw new Error('Paste your TenderAssist key.');
  // The sign-in stays until a key is accepted: an account with no key types one next, without signing in again.
  const view = await licence.activate(key);
  // The key's Google account is also the Drive account: no second sign-in in Settings.
  // The key is active either way; a failure here leaves Settings asking to sign in to Google.
  if (pendingLicenceSignIn) await keepGoogleSignIn(pendingLicenceSignIn).catch((error) => console.error('[TenderAssist] Could not keep the Google sign-in for Drive:', error));
  pendingLicenceSignIn = null;
  return view;
});
ipcMain.handle('forget-licence-sign-in', async (): Promise<LicenceView> => {
  pendingLicenceSignIn = null;
  return licence.forgetSignIn();
});
ipcMain.handle('check-licence', (): Promise<LicenceView> => licence.check());
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
ipcMain.handle('get-portal-lock', (): PortalLockState => currentPortalLock());
ipcMain.handle('set-portal-control', (_event, take: unknown): PortalLockState => {
  operatorTookControl = take === true;
  applyPortalLock();
  return currentPortalLock();
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

/**
 * The DSC signer's needs (OpenWebStart, Java 8 or newer), checked and
 * installed with the installer's own script (build/prereqs.ps1, packed next
 * to the app), so Settings can install them when the operator skipped them
 * during setup.
 */
function prereqsScript(): string {
  return app.isPackaged ? join(process.resourcesPath, 'prereqs.ps1') : join(app.getAppPath(), 'build', 'prereqs.ps1');
}

function runPrereqs(args: string[], onLine?: (line: string) => void): Promise<{ code: number; lines: string[] }> {
  return new Promise((resolveRun, rejectRun) => {
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', prereqsScript(), ...args], { windowsHide: true });
    const lines: string[] = [];
    let pending = '';
    const take = (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? '';
      for (const line of parts.map((part) => part.trim()).filter(Boolean)) { lines.push(line); onLine?.(line); }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.once('error', rejectRun);
    child.once('close', (code) => { if (pending.trim()) { lines.push(pending.trim()); onLine?.(pending.trim()); } resolveRun({ code: code ?? 1, lines }); });
  });
}

async function signerStatus(): Promise<SignerStatus> {
  if (process.platform !== 'win32') return { supported: false, java: false, openWebStart: false, installing: signerInstalling };
  const { lines } = await runPrereqs(['-DetectOnly']);
  return { supported: true, java: lines.includes('java=yes'), openWebStart: lines.includes('openwebstart=yes'), installing: signerInstalling };
}

let signerInstalling = false;

ipcMain.handle('get-signer-status', (): Promise<SignerStatus> => { signerChecked = null; return signerStatus(); });

// The DSC signer check runs PowerShell (about a second); the checklist reuses it for a minute.
let signerChecked: { at: number; status: SignerStatus } | null = null;
async function signerStatusCached(): Promise<SignerStatus> {
  if (!signerChecked || Date.now() - signerChecked.at > 60_000) signerChecked = { at: Date.now(), status: await signerStatus() };
  return signerChecked.status;
}

/** The same words, in any order and case: a list still the starting examples. */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  const key = (list: readonly string[]) => [...new Set(list.map((word) => word.trim().toLocaleLowerCase().replace(/\s+/g, ' ')))].sort().join('\n');
  return key(a) === key(b);
}

/**
 * The first-time setup checklist. Every step is read from the app itself:
 * activation, login, DSC signer, folders, Drive, and the word lists, which
 * tick once they are the office's own (no longer the starting examples). A
 * list the operator keeps as it is can still be ticked by hand. A PC already
 * in use (it has runs) starts complete, so existing offices never see it.
 */
async function setupChecklist(): Promise<SetupChecklist> {
  let state = setupState.get();
  if (!state) state = setupState.save({ ...SetupChecklistRepository.empty(), completedAt: jobs.listAll().length > 0 ? new Date().toISOString() : null });
  const defaults = runConfigurations.getDefaults();
  const portal = state.portalId ? getPortalDefinition(state.portalId) : null;
  const needsSignIn = portal ? !isGemPortal(portal) : true;
  const licenceView = await licence.view();
  const login = portal && needsSignIn ? portalCredentials.get(portal.id) : null;
  const signer = needsSignIn && process.platform === 'win32' ? await signerStatusCached() : null;
  const categories = portal ? categoriesForPortal(defaults, portal) : defaults.productCategories;
  const categoriesAreExamples = sameList(categories, portal && isGemPortal(portal) ? DEFAULT_GEM_CATEGORIES : STARTING_PORTAL_CATEGORIES);
  const intentAreExamples = sameList(defaults.keywords, STARTING_INTENT_WORDS);
  const excludedAreExamples = sameList(defaults.excludedKeywords, STARTING_EXCLUDED_WORDS);
  const outputRoot = publishingSettings.get(portal?.id ?? DEFAULT_PORTAL_ID).localOutputRoot;
  const drive = googleDriveSettings.get();
  const steps: SetupStep[] = [
    { id: 'activate', automatic: true, done: !licenceView.enforced || licenceView.usable,
      detail: licenceView.account ? `Activated for ${licenceView.account}` : licenceView.enforced ? 'Not activated yet' : 'Activated' },
    { id: 'website', automatic: false, done: Boolean(portal), detail: portal ? portal.name : 'Not chosen yet' },
    needsSignIn
      ? { id: 'login', automatic: true, done: Boolean(login?.loginId), detail: login?.loginId ? `Login ID ${login.loginId}${login.encryptedPasswordBase64 ? ', password remembered' : ''}` : 'Not saved yet' }
      : { id: 'login', automatic: true, done: true, notNeeded: true, detail: `${portal?.name ?? 'This website'} has no sign-in` },
    !needsSignIn
      ? { id: 'signer', automatic: true, done: true, notNeeded: true, detail: `${portal?.name ?? 'This website'} has no DSC sign-in` }
      : { id: 'signer', automatic: true, done: process.platform !== 'win32' || Boolean(signer?.java && signer.openWebStart),
        detail: !signer ? 'Windows only' : signer.java && signer.openWebStart ? 'OpenWebStart and Java installed' : `Missing: ${[!signer.java && 'Java', !signer.openWebStart && 'OpenWebStart'].filter(Boolean).join(' and ')}` },
    { id: 'categories', automatic: true, done: categories.length > 0 && (Boolean(state.confirmed.categories) || !categoriesAreExamples),
      detail: categoriesAreExamples
        ? `${categories.length} starting examples: choose the categories your kind of work is listed in`
        : `${categories.length} ${categories.length === 1 ? 'category' : 'categories'} chosen` },
    { id: 'intent', automatic: true, done: defaults.keywords.length > 0 && (Boolean(state.confirmed.intent) || !intentAreExamples),
      detail: intentAreExamples
        ? `${defaults.keywords.length} starting examples: replace them with 2 to 4 phrases from tenders you bid for`
        : `${defaults.keywords.length} of your own words` },
    { id: 'excluded', automatic: true, done: Boolean(state.confirmed.excluded) || !excludedAreExamples,
      detail: excludedAreExamples
        ? `${defaults.excludedKeywords.length} starting examples: add the work you never bid for`
        : `${defaults.excludedKeywords.length} excluded ${defaults.excludedKeywords.length === 1 ? 'word' : 'words'}` },
    { id: 'folder', automatic: true, done: Boolean(outputRoot), detail: outputRoot || 'Not set' },
    { id: 'drive', automatic: true, done: Boolean(drive.folderName) && driveSignInUsable(),
      detail: drive.folderName && driveSignInUsable() ? `My Drive / ${drive.folderName}` : !driveSignInUsable() ? 'Not signed in to Google' : 'No folder name yet' },
  ];
  const allDone = steps.every((step) => step.done);
  if (allDone && !state.completedAt) state = setupState.save({ ...state, completedAt: new Date().toISOString() });
  return { steps, portalId: state.portalId, complete: Boolean(state.completedAt) };
}

ipcMain.handle('get-setup-checklist', (): Promise<SetupChecklist> => setupChecklist());

ipcMain.handle('save-setup-checklist', (_event, change: unknown): Promise<SetupChecklist> => {
  const value = (change ?? {}) as { portalId?: unknown; confirm?: unknown };
  const state = setupState.get() ?? SetupChecklistRepository.empty();
  if (typeof value.portalId === 'string') state.portalId = getPortalDefinition(value.portalId).id;
  if (value.confirm === 'categories' || value.confirm === 'intent' || value.confirm === 'excluded') state.confirmed = { ...state.confirmed, [value.confirm]: new Date().toISOString() };
  setupState.save(state);
  return setupChecklist();
});

/** Downloads (checked by SHA-256) and installs what is missing; Windows asks for permission once. Progress lines go to 'signer-install-progress'. */
ipcMain.handle('install-signer', async (): Promise<SignerStatus & { ok: boolean; message: string }> => {
  if (process.platform !== 'win32') throw new Error('The DSC signer setup is for Windows.');
  if (signerInstalling) throw new Error('The DSC signer is already being installed.');
  signerInstalling = true;
  try {
    const { code, lines } = await runPrereqs([], (line) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('signer-install-progress', line);
    });
    signerInstalling = false;
    const status = await signerStatus();
    const ok = status.java && status.openWebStart;
    const message = ok
      ? 'OpenWebStart and Java are installed. The DSC signer can run.'
      : code === 3 ? 'Windows permission was not given, so nothing was installed. Try again and choose Yes when Windows asks.'
        : code === 2 ? 'The download did not finish. Check the internet connection and try again.'
          : `Not everything installed (${lines[lines.length - 1] ?? `code ${code}`}). Try again, or install OpenWebStart from openwebstart.com.`;
    return { ...status, ok, message };
  } finally {
    signerInstalling = false;
  }
});

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
  const runTenders = documentRun || job.purpose === 'CHANGES'
    ? (documentRun ? jobs.documentTenderIds(job) : changeCheckIds(job)).map((id) => tenders.getById(id)).filter((tender): tender is TenderRow => Boolean(tender))
    : tenders.listForJob(jobId);
  return {
    jobId: job.id,
    jobState: job.state,
    purpose: documentRun ? 'DOCUMENTS' : job.purpose === 'CHANGES' ? 'CHANGES' : 'SEARCH',
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
      ...(job.purpose === 'CHANGES' ? { changesFound: changesFoundBy(jobId, tender) } : {}),
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
  /** Followed tenders were checked for changes in this sign-in, and what was found. */
  watchChecked?: boolean;
  watchNote?: string;
  /** Every job of this sign-in (one per date), for "This search" in the run panel. */
  sessionJobIds?: string[];
  /** The last in-session documents collection: what it saved. */
  documentsNote?: string;
  /** The operator asked for the check: read every followed tender, even ones read today. */
  watchForced?: boolean;
  changeCheck?: { at: string; message: string };
  /** GeM runs: no portal page; files come straight from GeM. */
  gem?: GemClient;
  downloader?: DocumentDownloader;
}

/** Claim the single active-run slot synchronously, before any await. */
function claimRun(): { abortController: AbortController; paceAction: PaceAction } {
  if (!licenceUsable) throw new Error(licenceRefusal);
  if (activeJobId) {
    throw new Error(backgroundRun
      ? 'TenderAssist is saving the files of the GeM tenders you approved. Try again in a minute.'
      : 'A job is already running. Wait for it to finish before starting another.');
  }
  activeJobId = 'pending';
  const abortController = new AbortController();
  activeJobAbortController = abortController;
  activeStopWatchingSessionLoss = undefined;
  lastActiveJobUpdate = undefined;
  activeSearchDate = undefined;
  activeBatch = undefined;
  activeRunContext = undefined;
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
  operatorTookControl = false;
  applyPortalLock();
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
  applyPortalLock();
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
      // Settings → Speed → Typing: one key at a time like a person, or all at once.
      typeText: automationSettings.get().typing === 'INSTANT' ? typeAllAtOnce : typeLikeAPerson(),
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
      { jobs, sessions, jobMachine, tenders, classifications, workflow, outputs: jobOutputs, signal: ctx.abortController.signal, downloader: ctx.downloader, readDocuments: (rows, report) => readTenderDocuments(rows, report), publishDaySheets: publishStoredJob },
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
      // Drive gets the kept tenders and the report sheet; the ones needing a look wait for a decision.
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

/** Whether the operator approved the tender (on Today, Tenders, or in the run's review). */
function isApprovedTender(tender: TenderRow): boolean {
  const lifecycle = tender.opportunity_id ? opportunities.getById(tender.opportunity_id)?.lifecycle : undefined;
  return lifecycle !== undefined && APPROVED_LIFECYCLES.includes(lifecycle);
}

/**
 * Drive gets what the day's sheet lists as kept: tenders the operator
 * approved, and ones TenderAssist shortlisted that the operator has not
 * rejected (operator, 16 Oct: the sheet listed 14 shortlisted bids and Drive
 * had none of their folders). Tenders needing a look, and rejected ones, stay local.
 */
function belongsOnDrive(tender: TenderRow): boolean {
  if (isReplacedByLaterSearch(tender)) return false;
  if (isApprovedTender(tender)) return true;
  const lifecycle = tender.opportunity_id ? opportunities.getById(tender.opportunity_id)?.lifecycle : undefined;
  if (lifecycle === 'REJECTED') return false;
  return (workflow.getReview(tender.id)?.decision ?? classifications.getFinalForTender(tender.id)) === 'KEEP';
}

const hasSavedDocuments = (tender: TenderRow) => workflow.listDocuments(tender.id).some((document) => document.state === 'DOWNLOADED');

/**
 * A website lists an open bid in every search until it closes, so one
 * approved bid can have a row in several runs (two GeM searches on one day
 * gave each of 15 approved bids two folders, and Drive got 30). It is filed
 * once: under its latest row with saved files, or else its latest row. Another
 * row stays off the sheets and Drive, unless it has saved files of its own.
 */
function isFiledElsewhere(tender: TenderRow): boolean {
  if (!tender.opportunity_id || !isApprovedTender(tender) || hasSavedDocuments(tender)) return false;
  const filed = filedRow(tender.opportunity_id);
  return filed !== undefined && filed.id !== tender.id;
}

// A search past these has saved its tenders and is writing its sheet.
const SEARCH_SAVED_STATES: readonly string[] = ['UPLOADING', 'REPORTING', 'COMPLETE'];

// Asked for every tender during an upload or sheet write: read again at most every 2 seconds.
let supersededCache: { at: number; byDirectory: Map<string, Set<string>> } = { at: 0, byDirectory: new Map() };

/** The runs in a day folder that a later search of the same date replaced (supersededRuns). */
function supersededInDayFolder(jobDirectory: string): Set<string> {
  if (Date.now() - supersededCache.at > 2_000) supersededCache = { at: Date.now(), byDirectory: new Map() };
  const key = resolve(jobDirectory).toLocaleLowerCase();
  const cached = supersededCache.byDirectory.get(key);
  if (cached) return cached;
  const superseded = supersededRuns(jobOutputs.jobsInDirectory(jobDirectory).flatMap((jobId) => {
    const config = runConfigurations.getForJob(jobId);
    const plan = jobOutputs.getPlan(jobId);
    const job = jobs.getById(jobId);
    if (!config || !plan || !job) return [];
    return [{
      jobId,
      runNumber: plan.runNumber,
      portalId: config.portalId ?? DEFAULT_PORTAL_ID,
      searchKey: [config.searchDate, config.dateMeaning ?? 'PUBLISHED', config.closingFrom ?? ''].join(' '),
      finished: SEARCH_SAVED_STATES.includes(job.state),
      isSearch: (job.purpose ?? 'SEARCH') === 'SEARCH',
    }];
  }));
  supersededCache.byDirectory.set(key, superseded);
  return superseded;
}

/**
 * A tender of a search the same date's later search replaced: off the sheet,
 * its folder binned here and on Drive. One the operator approved stays,
 * unless the later search found the bid again (its row carries the approval).
 */
function isReplacedByLaterSearch(tender: TenderRow): boolean {
  const plan = jobOutputs.getPlan(tender.job_id);
  if (!plan) return false;
  const superseded = supersededInDayFolder(plan.jobDirectory);
  if (!superseded.has(tender.job_id)) return false;
  if (!isApprovedTender(tender)) return true;
  const portalId = runConfigurations.getForJob(tender.job_id)?.portalId;
  return jobOutputs.jobsInDirectory(plan.jobDirectory).some((jobId) => !superseded.has(jobId)
    && runConfigurations.getForJob(jobId)?.portalId === portalId
    && db.prepare(`SELECT 1 FROM tenders WHERE job_id = ? AND tender_ref = ? AND COALESCE(tender_portal_id, '') = ?`)
      .get(jobId, tender.tender_ref, tender.tender_portal_id ?? '') !== undefined);
}

/** The saved folders of a day folder's replaced tenders (isReplacedByLaterSearch). */
function replacedTenderFolders(jobDirectory: string): string[] {
  const folders: string[] = [];
  for (const jobId of supersededInDayFolder(jobDirectory)) {
    const plan = jobOutputs.getPlan(jobId);
    if (!plan) continue;
    for (const tender of tenders.listForJob(jobId)) {
      const serialNumber = jobOutputs.findSerialNumber(tender.id);
      if (serialNumber === undefined || !isReplacedByLaterSearch(tender)) continue;
      folders.push(tenderOutputDirectory(plan.jobDirectory, tender, serialNumber, plan.structure, plan.outputDate));
    }
  }
  return folders;
}

/** Moves replaced tenders' folders to the Recycle Bin, so the day folder holds only the latest search. */
async function binReplacedTenderFolders(jobDirectory: string): Promise<void> {
  for (const folder of replacedTenderFolders(jobDirectory)) {
    if (!existsSync(folder)) continue;
    try { await shell.trashItem(folder); }
    catch (error) { console.error(`[TenderAssist] Could not move the replaced folder ${folder} to the Recycle Bin:`, error); }
  }
}

/** The row an approved bid is filed under (see isFiledElsewhere). */
function filedRow(opportunityId: string): TenderRow | undefined {
  const rows = tenders.listForOpportunity(opportunityId);
  return [...rows].reverse().find(hasSavedDocuments) ?? rows.at(-1);
}

/**
 * Copy approved tenders' saved folders from the local output folder to the
 * portal's Drive folder. Tenders without a saved folder, or portals without
 * a Drive folder, are skipped. Returns the problems, if any.
 */
function copyApprovedTendersToDrive(tenderRows: TenderRow[]): string[] {
  const problems: string[] = [];
  const sheetsCopied = new Set<string>();
  for (const tender of tenderRows) {
    if (!belongsOnDrive(tender) || isFiledElsewhere(tender)) continue;
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

/**
 * TenderAssist's own Google sign-in credential, packed into the build from
 * google-oauth-client.json (kept out of git). Operators never see it. The
 * licence and Drive share it: one sign-in gives both.
 */
function builtInGoogleClient(): DriveCredentials | null {
  try { return parseGoogleClientFile(readFileSync(join(app.getAppPath(), 'google-oauth-client.json'), 'utf8')); }
  catch { return null; }
}

/** Whether the saved Drive sign-in was made with this build's Google client (a sign-in made with a folder link, before the folder name, has none recorded). */
function driveSignInUsable(): boolean {
  const settings = googleDriveSettings.get();
  const credentials = builtInGoogleClient();
  return Boolean(credentials && settings.refreshTokenEncrypted && (!settings.clientId || settings.clientId === credentials.clientId));
}

/** Signs in with Google in the browser: who the person is, and Drive access. */
async function googleSignIn(): Promise<GoogleSignIn> {
  const credentials = builtInGoogleClient();
  if (!credentials) throw new Error('This copy of TenderAssist was built without Google sign-in. Ask for a build that includes it.');
  try {
    return await signInWithGoogle(credentials, async (url) => {
      googleSignInLink = url;
      await shell.openExternal(url);
    });
  } finally {
    googleSignInLink = null;
  }
}

/** Keeps a Google sign-in for Drive uploads, and makes the Drive folder when its name is already set. */
async function keepGoogleSignIn(signIn: GoogleSignIn): Promise<void> {
  const previous = googleDriveSettings.get();
  const sameAccount = previous.accountEmail.toLowerCase() === signIn.email.toLowerCase();
  googleDriveSettings.save({
    ...previous,
    clientId: builtInGoogleClient()?.clientId ?? '',
    refreshTokenEncrypted: await encryptText(signIn.refreshToken),
    accountEmail: signIn.email,
    connectedAt: new Date().toISOString(),
    // Another account cannot see the old account's folder: make it again there.
    folderId: sameAccount ? previous.folderId : '',
  });
  const client = await googleDriveClient();
  if (client && googleDriveSettings.get().folderName) {
    // A missing folder is made at the next upload; the sign-in itself has worked.
    await driveFolderFor(client).catch((error) => console.error('[TenderAssist] Could not make the Drive folder after sign-in:', error));
  }
}

/** A Drive client for the saved sign-in, or null when not signed in. */
async function googleDriveClient(): Promise<GoogleDriveClient | null> {
  if (!driveSignInUsable()) return null;
  const refreshToken = await decryptText(googleDriveSettings.get().refreshTokenEncrypted);
  return refreshToken ? new GoogleDriveClient(builtInGoogleClient()!, refreshToken) : null;
}

/**
 * The Drive folder uploads go into, by the name typed in Settings. Found in
 * My Drive among the folders TenderAssist made, or made there; made again if
 * it was deleted or binned. Inside it: month folders, then day folders.
 */
async function driveFolderFor(client: GoogleDriveClient): Promise<string> {
  const settings = googleDriveSettings.get();
  if (settings.folderId) {
    try {
      await client.folder(settings.folderId);
      return settings.folderId;
    } catch (error) {
      if (!(error instanceof GoogleDriveError && error.status === 404)) throw error;
    }
  }
  const parts = driveFolderNameParts(settings.folderName);
  if (parts.length === 0) throw new Error('Type a Drive folder name in Settings → Upload to Google Drive.');
  const folderId = await client.ensurePath('root', parts);
  googleDriveSettings.save({ ...googleDriveSettings.get(), folderId });
  return folderId;
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
    signedIn: driveSignInUsable(),
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

// Replaced tender folders already looked for on Drive this session (day folder id / name).
const driveBinnedFolders = new Set<string>();

/**
 * Uploads tenders' saved folders, and the report sheets of their day folders,
 * to the Google Drive folder in the same layout as the local output folder.
 * Queued one batch after another in the background; nothing waits on Drive.
 */
function uploadToGoogleDrive(tenderRows: TenderRow[], extraDayDirectories: Array<{ jobId: string }> = [], label = 'Google Drive upload'): Promise<DriveUploadSummary | null> {
  const run = driveUploads.then(async (): Promise<DriveUploadSummary | null> => {
    const client = await googleDriveClient();
    const settings = googleDriveSettings.get();
    if (!client || (!settings.folderName && !settings.folderId)) return null;
    driveUploading = true;
    const summary: DriveUploadSummary = { tenders: 0, files: 0, problems: [] };
    const folderId = await driveFolderFor(client).catch((error: unknown) => {
      summary.problems.push(`The Drive folder “${settings.folderName}”: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    const drive = { client, folderId: folderId ?? '' };
    const days = new Map<string, { plan: NonNullable<ReturnType<typeof jobOutputs.getPlan>> }>();
    for (const { jobId } of extraDayDirectories) {
      const plan = jobOutputs.getPlan(jobId);
      if (plan && existsSync(plan.jobDirectory)) days.set(plan.jobDirectory, { plan });
    }
    try {
      for (const tender of folderId ? tenderRows : []) {
        // A tender needing a look stays on this computer until approved
        // (afterApproval); a rejected one never goes (belongsOnDrive).
        if (!belongsOnDrive(tender) || isFiledElsewhere(tender)) continue;
        const plan = jobOutputs.getPlan(tender.job_id);
        const serialNumber = jobOutputs.findSerialNumber(tender.id);
        if (!plan || serialNumber === undefined) continue;
        const folder = tenderOutputDirectory(plan.jobDirectory, tender, serialNumber, plan.structure, plan.outputDate);
        if (!existsSync(folder)) continue;
        days.set(plan.jobDirectory, { plan });
        try {
          const segments = driveFolderPath(plan.outputRoot, folder);
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
      for (const { plan } of folderId ? days.values() : []) {
        try {
          const segments = driveFolderPath(plan.outputRoot, plan.jobDirectory);
          const dayId = await drive.client.ensurePath(drive.folderId, segments);
          const baseName = resolveOutputStructure(plan.structure, plan.outputDate).approvedWorkbook;
          const sheets = readdirSync(plan.jobDirectory).filter((name) => isDaySheet(baseName, name));
          for (const name of sheets) {
            if (await drive.client.putFile(dayId, join(plan.jobDirectory, name), name) === 'uploaded') summary.files += 1;
          }
          // Sheets under names no longer used on this computer ("(run 2)", the other split) go to Drive's bin.
          const kept = new Set(sheets.map((name) => name.toLocaleLowerCase()));
          for (const file of await drive.client.files(dayId)) {
            if (isDaySheet(baseName, file.name) && !kept.has(file.name.toLocaleLowerCase())) await drive.client.binFile(file.id);
          }
          // Folders of tenders a later search of the date replaced go to Drive's bin too.
          for (const folder of replacedTenderFolders(plan.jobDirectory)) {
            const name = basename(folder);
            if (driveBinnedFolders.has(`${dayId}/${name}`)) continue;
            const item = await drive.client.child(dayId, name, true);
            if (item) await drive.client.binFile(item.id);
            driveBinnedFolders.add(`${dayId}/${name}`);
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

/** After a run: the report sheet, and the folders of the tenders kept on it; tenders needing a look stay local. */
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

/**
 * Approved GeM tenders get their files at once (GeM needs no sign-in), in a
 * run of their own in the background; if another run is going, as soon as it
 * ends (finishRun). Their day sheets are rewritten when the files are saved.
 */
let gemDocumentsWanted = false;
/** The run going now is such a background run: the screen does not follow it. */
let backgroundRun = false;
function scheduleGemDocuments(): void {
  gemDocumentsWanted = true;
  if (activeJobId || !licenceUsable) return;
  gemDocumentsWanted = false;
  const portal = getPortalDefinition('gem');
  if (gemApprovedWaitingForDocuments(portal.id).length === 0) return;
  backgroundRun = true;
  startGemDocumentRun(portal).catch((error) => {
    backgroundRun = false;
    console.error('[TenderAssist] Could not save the files of approved GeM tenders:', error);
  });
}

const isGemTender = (tender: TenderRow) => isGemPortal(getPortalDefinition(runConfigurations.getForJob(tender.job_id)?.portalId ?? DEFAULT_PORTAL_ID));

/** Documents and Drive copy for tenders the operator just approved. */
function afterApproval(tenderRows: TenderRow[]): void {
  if (tenderRows.some(isGemTender)) scheduleGemDocuments();
  for (const jobId of new Set(tenderRows.map((tender) => tender.job_id))) {
    syncOpportunities('documents', () => recordCollectedDocuments(opportunitySync, jobId));
  }
  void refreshDaySheets(tenderRows).then(() => {
    reportDriveProblems(copyApprovedTendersToDrive(tenderRows));
    if (runsUploadToDrive()) uploadSavedTendersToGoogleDrive(tenderRows);
  });
}

/**
 * A decision made after the run (on Today or Tenders, any day later) is
 * written into that day's report sheet, so the sheet on this computer and on
 * Drive always shows what was approved or rejected. Runs in the background.
 */
async function refreshDaySheets(tenderRows: TenderRow[]): Promise<void> {
  for (const jobId of new Set(tenderRows.map((tender) => tender.job_id))) {
    // A search still saving writes its own sheet when it finishes. One that has
    // finished and waits signed in ("What next?") already wrote it: rewrite it,
    // or a tender approved in the live review never reaches the sheet.
    const state = jobs.getById(jobId)?.state;
    if (jobId === activeJobId && state !== 'COMPLETE' && state !== 'REPORTING') continue;
    try { await publishStoredJob(jobId); }
    catch (error) { console.error(`Could not update the report sheet of run ${jobId}:`, error); }
  }
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
  return driveSignInUsable() && Boolean(settings.folderName || settings.folderId);
}

function runFinishedMessage(counts: CollectedCounts, dateCount = 1, inSession = false): string {
  const dates = dateCount > 1 ? ` across ${dateCount} published dates` : '';
  const drive = runsUploadToDrive() ? ` The report sheet is being uploaded to Google Drive; shortlisted tenders go with their documents, and the rest once you approve them.` : '';
  if (counts.shortlisted + counts.needsReview === 0) return `No tender matched your filters${dates}. ${inSession ? 'See “This search” below for what was found and why; you can still approve one there.' : 'Open a run to see what was checked.'}${drive}`;
  const parts = [
    counts.shortlisted > 0 && `${counts.shortlisted} shortlisted`,
    counts.needsReview > 0 && `${counts.needsReview} need${counts.needsReview === 1 ? 's' : ''} your review`,
  ].filter(Boolean).join(' and ');
  return `${parts}${dates}. Kept tenders' documents are saved in your folder.${drive} ${inSession ? 'Review them under “This search” below, or later on Today.' : 'Decide them on the Today page.'}`;
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
    { ...deps, searches, onCategoryList: (categories) => rememberCategoryList(portal.id, categories) },
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
      // Every chosen date has run. While still signed in, check the tenders
      // the operator follows for extensions and corrigenda, once per sign-in.
      if (!ctx.watchChecked && lastResult) {
        ctx.watchChecked = true;
        const result = lastResult;
        const summary = await checkWatchedTenders(ctx, result.jobId, authSessionId, (statusMessage) => emitJobUpdate({ ...result, outcome: undefined, statusMessage }), ctx.watchForced)
          .catch((error) => { console.error('[TenderAssist] checking followed tenders failed:', error); return null; });
        if (ctx.abortController.signal.aborted) return;
        ctx.watchNote = summary ? describeWatch(summary) : 'Followed tenders could not be checked for changes this time; use "Check for changes" on Today.';
        if (!ctx.watchNote && ctx.watchForced) ctx.watchNote = `No tender is followed on ${ctx.portal.name} yet: approve one, mark it for later, or leave it waiting for you, and it is checked here.`;
        ctx.changeCheck = { at: new Date().toISOString(), message: ctx.watchNote || 'Nothing to check: every followed tender was read during this search.' };
      }
      // The website's daily totals for the report, read in the background from its public lists.
      const lastTotals = dailyCounts.lastReadAt(ctx.portal.id);
      if (!lastTotals || Date.now() - Date.parse(lastTotals) > PUBLIC_COUNTS_MAX_AGE_MS) {
        void refreshPublicCounts(ctx.portal).catch((error) => console.error('[TenderAssist] website totals not read:', error));
      }
      // Keep the portal signed in and ask.
      const skippedNote = [describeSkipped(batch.skipped), ctx.watchNote].filter(Boolean).join(' ');
      emitJobUpdate({
        ...lastResult!,
        outcome: undefined,
        awaitingMoreDates: true,
        changeCheck: ctx.changeCheck,
        documentsNote: ctx.documentsNote,
        statusMessage: `${runFinishedMessage(collected, batch.done.length, true)}${skippedNote ? ` ${skippedNote}` : ''}`,
      });
      // The operator may browse the portal while deciding.
      portalHost?.setAutomationPopups(false);
      const more = await waitForMoreDates(ctx.abortController.signal);
      portalHost?.setAutomationPopups(true);
      if (ctx.abortController.signal.aborted) return;
      if (!more) {
        emitJobUpdate({ ...lastResult!, awaitingMoreDates: false, outcome: 'SUCCESS', statusMessage: [runFinishedMessage(collected, batch.done.length), ctx.watchNote].filter(Boolean).join(' ') });
        return;
      }
      if (more.collectApproved) {
        // "Collect documents now": approved tenders' files, in this same sign-in.
        const targets = approvedWaitingForDocuments(ctx.portal.id).ready;
        if (targets.length > 0) {
          const docJob = jobs.create();
          jobMachine.transition(docJob.id, 'AUTH_REQUIRED', 'documents in the same portal session');
          jobMachine.transition(docJob.id, 'AUTH_PENDING', 'reusing the signed-in portal session');
          jobMachine.transition(docJob.id, 'AUTHENTICATED', 'portal session already signed in');
          runConfigurations.saveForJob(docJob.id, { ...ctx.config, searchDate: new Date().toLocaleDateString('en-CA') });
          jobs.markDocumentRun(docJob.id, targets.map((tender) => tender.id));
          ctx.sessionJobIds = [...(ctx.sessionJobIds ?? []), docJob.id];
          await collectApprovedDocuments(ctx, docJob.id, authSessionId, targets, { inSession: (message) => { ctx.documentsNote = message; } });
          if (ctx.abortController.signal.aborted || sessionWasLost(authSessionId)) return;
        } else {
          ctx.documentsNote = 'No approved tender is waiting for its documents.';
        }
        index -= 1;
        continue;
      }
      if (more.checkChanges) {
        // "Check for changes" from the run panel: check again, then ask again.
        ctx.watchChecked = false;
        ctx.watchForced = true;
        index -= 1;
        continue;
      }
      dates = [...dates, ...more.toRun];
      batch = { dates: [...dates], done: batch.done, skipped: [...batch.skipped, ...more.skipped] };
      activeBatch = batch;
      index -= 1;
      continue;
    }

    activeSearchDate = date;
    let jobId = index === 0 ? firstJobId : startDateJob(ctx, date);
    ctx.sessionJobIds = [...(ctx.sessionJobIds ?? []), jobId];
    let { result, selected } = await runDate(ctx, jobId, authSessionId);
    // A crashed or signed-out portal restarts this date after signing in again.
    for (let recovery = 1; result.outcome !== 'SUCCESS' && recovery <= MAX_DATE_RECOVERIES && sessionWasLost(result.authSessionId || authSessionId); recovery += 1) {
      if (ctx.abortController.signal.aborted) break;
      endJob(jobId, 'portal page crashed or signed out; the date is restarted after signing in again');
      const signedIn = await signInAgainForDate(ctx, date);
      if (!signedIn) return;
      jobId = signedIn.jobId;
      authSessionId = signedIn.authSessionId;
      ctx.sessionJobIds = [...(ctx.sessionJobIds ?? []), jobId];
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
      backgroundRun = false;
      // GeM tenders approved while this run went: their files now.
      if (gemDocumentsWanted) setTimeout(scheduleGemDocuments, 2_000);
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
  const categoryCodes = await gemCategoryCodes(ctx.portal);
  // Product bids are searched when a chosen category is a product one (GeM's
  // service codes start "services_"), or when the old setting asked for them.
  const includeProducts = runConfigurations.getDefaults().gemIncludeProducts
    || ctx.config.productCategories.some((name) => isGemProductCode(gemCodeFor(name, categoryCodes)));
  let batch = { dates: [...plan.toRun], done: [] as string[], skipped: [...plan.skipped] };
  activeBatch = batch;
  const collected: CollectedCounts = { shortlisted: 0, needsReview: 0 };
  let last: AuthJobUpdate | undefined;
  // The search words look across every open bid, so once per batch (its first date) is enough.
  const searchWords = runConfigurations.getDefaults().gemSearchWords ?? [];
  // A search-word bid already decided, or already waiting in the Inbox, is not read again;
  // one rejected automatically before (wrong day or category) is, as the word is the reason to keep it.
  const skipWordHit = (bid: GemBid): boolean => {
    const known = opportunities.findByIdentity(ctx.portal.id, OpportunityRepository.identityKey(bid.id, bid.bidNumber));
    if (!known) return false;
    return !(known.lifecycle === 'NEW' || known.lifecycle === 'SCREENED') || known.recommendation === 'KEEP' || known.recommendation === 'UNCERTAIN';
  };
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
      onDayCounts: (day, total, categories) => dailyCounts.record(ctx.portal.id, day, total, 'GEM_LIST', categories),
      askOperator: (tender, reason, documentUrl) => askOperatorDuringRun(ctx, jobId, tender, reason, documentUrl),
      searchWords: index === 0 ? searchWords : undefined,
      skipWordHit,
      skipKnown: skipWordHit,
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
  // GeM needs no sign-in: the followed bids are checked at the end of every GeM run.
  const finished = last;
  const watch = await checkWatchedGemBids(ctx, finished.jobId, (statusMessage) => emitJobUpdate({ ...finished, outcome: undefined, statusMessage }))
    .catch((error) => { console.error('[TenderAssist] checking followed GeM bids failed:', error); return null; });
  if (signal.aborted) return;
  const skippedNote = [describeSkipped(batch.skipped), watch ? describeWatch(watch) : 'Followed bids could not be checked for changes this time; use "Check for changes" on Today.'].filter(Boolean).join(' ');
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
    const latest = filedRow(opportunity.id);
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
    // Read inside the files (OCR for scans) and find the requirements again.
    await readTenderDocuments(targets, (statusMessage) => emitJobUpdate(update({ statusMessage }))).catch(() => {});
    // Their day sheets list them now, with their files and eligibility sheets (before Drive gets the sheets).
    await refreshDaySheets(targets);
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
// ── Watching followed tenders for extensions and corrigenda ─────────────────

/** What a check for changes found for one tender, in history wording. */
function changesFoundBy(jobId: string, tender: TenderRow): string[] {
  if (!tender.opportunity_id) return [];
  const events = opportunities.listEvents(tender.opportunity_id)
    .filter((event) => event.job_id === jobId && ['CHANGED', 'CORRIGENDUM', 'CANCELLED', 'NOTE'].includes(event.kind));
  return describeTimeline(events).map((entry) => (entry.detail ? `${entry.title}: ${entry.detail}` : entry.title));
}

/** The followed tenders a "Check for changes" run reopened. */
function changeCheckIds(job: { purpose?: string; document_tender_ids_json?: string | null }): string[] {
  if (job.purpose !== 'CHANGES' || !job.document_tender_ids_json) return [];
  try { return (JSON.parse(job.document_tender_ids_json) as unknown[]).filter((id): id is string => typeof id === 'string'); } catch { return []; }
}

// ── Reading inside saved documents (PDF text, Windows OCR for scans) ────────

const documentOcr: OcrEngine | null = windowsOcrAvailable() ? { pdfPages: ocrPdfPages, image: ocrImage } : null;
// One document at a time, app-wide: OCR is heavy and runs share the queue.
let documentReading: Promise<unknown> = Promise.resolve();

/**
 * Reads the text inside every saved, not yet read document of these
 * tenders, then finds their requirements again from the tender page plus
 * the documents. Safe to repeat; a file that cannot be read is skipped.
 */
function readTenderDocuments(rows: TenderRow[], report: (message: string) => void = () => {}): Promise<void> {
  const run = documentReading.then(async () => {
    for (const tender of rows) {
      const unread = workflow.listDocuments(tender.id).filter((document) =>
        document.state === 'DOWNLOADED' && document.local_path && !document.text_read_at
        && canReadDocument(document.local_path) && existsSync(document.local_path));
      if (unread.length === 0) continue;
      for (const [index, document] of unread.entries()) {
        report(`Reading ${document.file_name} of ${tender.title} (${index + 1} of ${unread.length}).`);
        try {
          workflow.saveDocumentText(document.id, await readDocumentText(document.local_path!, documentOcr));
        } catch (error) {
          console.error(`[TenderAssist] could not read ${document.local_path}:`, error);
          workflow.saveDocumentText(document.id, { text: '', method: 'NONE', pages: 0, ocrPages: 0 });
        }
      }
      const extraction = extractTenderRequirements([tender.detail_text ?? '', documentsTextFor(workflow.listDocuments(tender.id))].filter(Boolean).join('\n\n'));
      workflow.saveRequirements(tender.id, extraction.requirements, extraction.confidence);
    }
  });
  documentReading = run.catch(() => {});
  return run;
}

/** Documents saved before reading was added: read in the background, a while after start-up. */
function catchUpDocumentReading(): void {
  const rows = jobs.listAll().flatMap((job) => tenders.listForJob(job.id))
    .filter((tender) => workflow.listDocuments(tender.id).some((document) => document.state === 'DOWNLOADED' && !document.text_read_at));
  if (rows.length > 0) void readTenderDocuments(rows).catch((error) => console.error('[TenderAssist] document catch-up failed:', error));
}
setTimeout(catchUpDocumentReading, 20_000);

/**
 * Days searched again before a later search replaced the earlier one (before
 * 0.7.4): at start-up, each such day's sheet is written again without the
 * replaced search and its folders go to the Recycle Bin. "Upload everything
 * saved so far" then bins them on Drive too.
 */
function retireReplacedSearches(): void {
  const days = new Map<string, string>();
  for (const job of jobs.listAll()) {
    const plan = jobOutputs.getPlan(job.id);
    if (plan && job.id !== activeJobId) days.set(resolve(plan.jobDirectory).toLocaleLowerCase(), job.id);
  }
  for (const jobId of days.values()) {
    const plan = jobOutputs.getPlan(jobId);
    if (!plan || !replacedTenderFolders(plan.jobDirectory).some((folder) => existsSync(folder))) continue;
    publishStoredJob(jobId).catch((error) => console.error(`[TenderAssist] Could not clear the replaced search of ${plan.outputDate}:`, error));
  }
}
setTimeout(retireReplacedSearches, 15_000);

/** At most this many tender pages are reopened per check, soonest closing first, to keep runs short. */
const WATCH_MAX_PER_CHECK = 40;
/** A page read this recently (by today's search, for example) is not read again. */
const WATCH_FRESH_MS = 20 * 3_600_000;

/**
 * Tenders the operator follows on this website: approved, decide later, and
 * waiting for a decision (not rejected), while open or just closed. Each as
 * the sighting to reopen from My Tenders.
 */
function watchedTenderRows(portalId: string, now = new Date()): TenderRow[] {
  const rows: TenderRow[] = [];
  for (const opportunity of opportunities.list({ portalId })) {
    const lifecycle = opportunity.lifecycle === 'EXPIRED' ? opportunities.lifecycleBeforeExpiry(opportunity.id) : opportunity.lifecycle;
    if (!lifecycle || !isWatched({ ...opportunity, lifecycle }, now)) continue;
    const sightings = tenders.listForOpportunity(opportunity.id);
    const sighting = [...sightings].reverse().find((tender) => tender.favorited === 1) ?? sightings.at(-1);
    if (sighting) rows.push(sighting);
  }
  return rows;
}

interface WatchSummary {
  checked: number;
  notFound: number;
  extended: Array<{ title: string; from: string | null; to: string }>;
  corrigenda: number;
  reopened: number;
  cancelled: number;
  filesSaved: number;
}

const corrigendumNumbers = (opportunityId: string) => new Set(opportunities.listEvents(opportunityId)
  .filter((event) => event.kind === 'CORRIGENDUM')
  .map((event) => (JSON.parse(event.data_json) as { portalNumber?: string | null }).portalNumber ?? ''));

function describeWatch(summary: WatchSummary): string {
  if (summary.checked === 0) return '';
  const parts = [
    summary.extended.length > 0 && `${summary.extended.length} extended (${summary.extended.slice(0, 3).map((item) => `${item.title.slice(0, 40)}: now ${item.to}`).join('; ')}${summary.extended.length > 3 ? '; …' : ''})`,
    summary.corrigenda > 0 && `${summary.corrigenda} new ${summary.corrigenda === 1 ? 'corrigendum' : 'corrigenda'}`,
    summary.reopened > 0 && `${summary.reopened} open again`,
    summary.cancelled > 0 && `${summary.cancelled} cancelled`,
  ].filter(Boolean);
  const found = summary.notFound > 0 ? ` ${summary.notFound} ${summary.notFound === 1 ? 'was' : 'were'} no longer in My Tenders.` : '';
  return parts.length > 0
    ? `Checked ${summary.checked} ${summary.checked === 1 ? 'tender' : 'tenders'} you follow: ${parts.join(', ')}.${found}`
    : `Checked ${summary.checked} ${summary.checked === 1 ? 'tender' : 'tenders'} you follow: no extensions or corrigenda.${found}`;
}

/** Saves the files of new corrigenda of an approved tender, in "Corrigendum <n>" inside its documents folder. */
async function saveCorrigendumFiles(ctx: RunContext, tender: TenderRow, detailPage: Page, portalNumbers: string[]): Promise<number> {
  const host = portalHost;
  if (!host || portalNumbers.length === 0) return 0;
  const config = runConfigurations.getForJob(tender.job_id) ?? ctx.config;
  const plan = jobOutputs.getOrCreatePlan(tender.job_id, ctx.outputSettings.localOutputRoot, config.searchDate, ctx.outputSettings.structure);
  const documents = tenderDocumentsDirectory(plan.jobDirectory, tender, jobOutputs.serialNumberFor(plan, tender.id), plan.structure, plan.outputDate);
  const saved = await downloadCorrigendumDocuments(detailPage, portalNumbers,
    (number) => (click) => host.captureDocument(join(documents, `Corrigendum ${number}`), click), ctx.paceAction);
  let files = 0;
  for (const [number, outcome] of saved) {
    const names = outcome.results.filter((result) => result.filePath).map((result) => result.fileName);
    files += names.length;
    const note = names.length > 0
      ? `Corrigendum ${number}: saved ${names.join(', ')} in "Corrigendum ${number}".`
      : `Corrigendum ${number}: its files could not be saved automatically (${outcome.error ?? 'none found on its page'}). Open the tender on the website to see them.`;
    if (tender.opportunity_id) {
      const id = tender.opportunity_id;
      syncOpportunities('corrigendum files', () => opportunities.addNote(id, note, 'automation', { jobId: tender.job_id }));
    }
  }
  return files;
}

/**
 * Reopens the pages of followed tenders from My Tenders, while signed in,
 * and records what changed: a later closing date, new corrigenda (their
 * files saved for approved tenders), a tender open again or cancelled.
 * Approved tenders that changed get their sheet row and Drive copy updated.
 */
async function checkWatchedTenders(ctx: RunContext, jobId: string, authSessionId: string, report: (message: string) => void, force = false): Promise<WatchSummary> {
  const summary: WatchSummary = { checked: 0, notFound: 0, extended: [], corrigenda: 0, reopened: 0, cancelled: 0, filesSaved: 0 };
  if (!ctx.page || isGemPortal(ctx.portal)) return summary;
  const now = Date.now();
  const due = watchedTenderRows(ctx.portal.id)
    // Asked for by the operator: every followed tender; after a search: only pages not read today.
    .filter((tender) => force || !tender.detail_reviewed_at || now - Date.parse(tender.detail_reviewed_at) > WATCH_FRESH_MS)
    .sort((a, b) => (opportunities.getById(a.opportunity_id ?? '')?.closing_at ?? '9999').localeCompare(opportunities.getById(b.opportunity_id ?? '')?.closing_at ?? '9999'))
    .slice(0, WATCH_MAX_PER_CHECK);
  if (due.length === 0) return summary;

  const before = new Map(due.map((tender) => {
    const opportunity = tender.opportunity_id ? opportunities.getById(tender.opportunity_id) : undefined;
    return [tender.id, { closing: opportunity?.closing_date ?? null, lifecycle: opportunity?.lifecycle, corrigenda: tender.opportunity_id ? corrigendumNumbers(tender.opportunity_id) : new Set<string>() }];
  }));
  report(`Checking ${due.length} ${due.length === 1 ? 'tender' : 'tenders'} you follow for extensions and corrigenda.`);
  await retryTransient(() => navigateToMyTenders(ctx.page!, ctx.paceAction, ctx.portal.url), {
    signal: ctx.abortController.signal,
    canRetry: () => !sessionWasLost(authSessionId),
  });
  let opened = 0;
  const batch = await reviewTendersFromMyTenders(ctx.page, due, 100, ctx.paceAction, async (tender, detail, detailPage) => {
    if (ctx.abortController.signal.aborted) return;
    opened += 1;
    report(`Checking ${tender.title} for changes (${opened} of ${due.length}).`);
    const detailText = detailTextFor(detail);
    const facts = tenderPageFacts(detailText);
    tenders.updateDetail(tender.id, {
      organisationChain: detail.organisationChain,
      department: detail.department ?? undefined,
      stateName: detail.stateName ?? undefined,
      publishedDate: (detail.publishedDateRaw ? parseTenderPortalDate(detail.publishedDateRaw) : null) ?? tender.published_date,
      productCategory: detail.productCategories[0] ?? tender.detail_product_category ?? tender.product_category,
      tenderCategory: detail.tenderCategory,
      detailText,
      documentLinks: detail.documentLinks,
      closingDate: facts.closingDateRaw,
    });
    // An approved tender's new corrigenda: save their files while the page is open.
    const was = before.get(tender.id);
    const approved = was?.lifecycle && (APPROVED_LIFECYCLES.includes(was.lifecycle)
      || (was.lifecycle === 'EXPIRED' && APPROVED_LIFECYCLES.includes(opportunities.lifecycleBeforeExpiry(tender.opportunity_id ?? '') ?? '')));
    const fresh = facts.corrigenda.map((entry) => entry.portalNumber ?? '').filter((number) => number && !was?.corrigenda.has(number));
    if (approved && fresh.length > 0) summary.filesSaved += await saveCorrigendumFiles(ctx, tender, detailPage, fresh).catch(() => 0);
  }, ctx.portal.url);

  const changedApproved: TenderRow[] = [];
  for (const tender of due) {
    if (!batch.reviewed.has(tender.id)) { summary.notFound += 1; continue; }
    summary.checked += 1;
    const row = tenders.getById(tender.id) ?? tender;
    let after: OpportunityRow | undefined;
    syncOpportunities('watch', () => { after = syncTenderSighting(opportunitySync, row, ctx.portal.id, { jobId }); });
    const was = before.get(tender.id)!;
    if (!after) continue;
    let changed = false;
    if (after.closing_date && was.closing && after.closing_date !== was.closing && (after.closing_at ?? '') > (toIsoClosing(was.closing) ?? '')) {
      summary.extended.push({ title: after.title, from: was.closing, to: after.closing_date });
      changed = true;
    }
    const newCorrigenda = [...corrigendumNumbers(after.id)].filter((number) => !was.corrigenda.has(number)).length;
    if (newCorrigenda > 0) { summary.corrigenda += newCorrigenda; changed = true; }
    if (was.lifecycle === 'EXPIRED' && after.lifecycle !== 'EXPIRED') summary.reopened += 1;
    if (was.lifecycle !== 'CANCELLED' && after.lifecycle === 'CANCELLED') { summary.cancelled += 1; changed = true; }
    if (changed && APPROVED_LIFECYCLES.includes(after.lifecycle)) changedApproved.push(row);
  }
  if (changedApproved.length > 0) {
    // The sheet shows the new closing date and corrigenda; the folder and sheet go to Drive.
    void refreshDaySheets(changedApproved).then(() => {
      reportDriveProblems(copyApprovedTendersToDrive(changedApproved));
      if (runsUploadToDrive()) uploadSavedTendersToGoogleDrive(changedApproved);
    });
  }
  return summary;
}

/**
 * GeM's version, with no sign-in: GeM lists bids by start date, and an
 * extension does not move a bid in that order, so each followed bid is found
 * again among the bids that started on its day. Its listing gives the
 * current closing date and whether it was cancelled. (GeM's corrigendum
 * documents are not read here.)
 */
async function checkWatchedGemBids(ctx: RunContext, jobId: string, report: (message: string) => void, force = false): Promise<WatchSummary> {
  const summary: WatchSummary = { checked: 0, notFound: 0, extended: [], corrigenda: 0, reopened: 0, cancelled: 0, filesSaved: 0 };
  const client = ctx.gem;
  if (!client) return summary;
  const now = Date.now();
  const due = watchedTenderRows(ctx.portal.id).filter((tender) => {
    const opportunity = tender.opportunity_id ? opportunities.getById(tender.opportunity_id) : undefined;
    return tender.tender_portal_id && tender.published_date && (force || !opportunity || now - Date.parse(opportunity.last_seen_at) > WATCH_FRESH_MS);
  });
  if (due.length === 0) return summary;
  const byDay = new Map<string, TenderRow[]>();
  for (const tender of due) {
    const day = tender.published_date!.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), tender]);
  }
  report(`Checking ${due.length} GeM ${due.length === 1 ? 'bid' : 'bids'} you follow for extensions and cancellations.`);
  const changedApproved: TenderRow[] = [];
  let day = 0;
  for (const [startDay, followed] of byDay) {
    if (ctx.abortController.signal.aborted) break;
    day += 1;
    report(`Checking GeM bids that started on ${startDay} (${day} of ${byDay.size} days).`);
    const listed = new Map((await findBidsStartedOn(startDay, (page) => retryTransient(() => client.listBids({ page, bidType: 'all' }), { signal: ctx.abortController.signal })))
      .map((bid) => [bid.id, bid]));
    for (const tender of followed) {
      const bid = listed.get(tender.tender_portal_id!);
      const opportunity = tender.opportunity_id ? opportunities.getById(tender.opportunity_id) : undefined;
      if (!bid || !opportunity) { summary.notFound += 1; continue; }
      summary.checked += 1;
      const was = { closing: opportunity.closing_date, closingAt: opportunity.closing_at, lifecycle: opportunity.lifecycle };
      const closing = portalStyleDate(bid.endsAt);
      if (closing) tenders.setClosingDate(tender.id, closing);
      let after: OpportunityRow | undefined;
      syncOpportunities('watch', () => {
        after = syncTenderSighting(opportunitySync, tenders.getById(tender.id) ?? tender, ctx.portal.id, { jobId });
        if (bid.cancelled && after.lifecycle !== 'CANCELLED' && canTransition(after.lifecycle, 'CANCELLED')) {
          after = opportunities.markCancelled(after.id, { jobId }, { reason: 'GeM lists the bid as cancelled' });
        }
      });
      if (!after) continue;
      let changed = false;
      if (closing && was.closing && closing !== was.closing && (after.closing_at ?? '') > (was.closingAt ?? '')) {
        summary.extended.push({ title: after.title, from: was.closing, to: closing });
        changed = true;
      }
      if (was.lifecycle === 'EXPIRED' && after.lifecycle !== 'EXPIRED' && after.lifecycle !== 'CANCELLED') summary.reopened += 1;
      if (was.lifecycle !== 'CANCELLED' && after.lifecycle === 'CANCELLED') { summary.cancelled += 1; changed = true; }
      if (changed && APPROVED_LIFECYCLES.includes(after.lifecycle)) changedApproved.push(tender);
    }
  }
  if (changedApproved.length > 0) {
    void refreshDaySheets(changedApproved).then(() => {
      reportDriveProblems(copyApprovedTendersToDrive(changedApproved));
      if (runsUploadToDrive()) uploadSavedTendersToGoogleDrive(changedApproved);
    });
  }
  return summary;
}

/** ISO time of a closing date as the website writes it, for comparing two of them. */
function toIsoClosing(raw: string): string | null {
  const parsed = parseTenderPortalDate(raw);
  return parsed ? new Date(parsed).toISOString() : null;
}

async function collectApprovedDocuments(ctx: RunContext, jobId: string, authSessionId: string, targets: TenderRow[], options: { inSession?: (message: string) => void } = {}): Promise<void> {
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
        closingDate: tenderPageFacts(detailTextFor(detail)).closingDateRaw,
      });
      const config = runConfigurations.getForJob(tender.job_id) ?? ctx.config;
      // A failed file is recorded as not saved; the next documents run tries it again.
      await saveTenderDocuments(ctx, tender.job_id, config, tender, detailPage).catch(() => {});
    }, ctx.portal.url);
    if (signal.aborted) throw new Error(USER_CANCELLED_REASON);
    for (const sourceJob of new Set(targets.map((tender) => tender.job_id))) {
      syncOpportunities('documents', () => recordCollectedDocuments(opportunitySync, sourceJob));
    }
    // Read inside the files (OCR for scans) and find the requirements again.
    await readTenderDocuments(targets, (statusMessage) => emitJobUpdate(update({ statusMessage }))).catch(() => {});
    // Their day sheets list them now, with what their documents say (before Drive gets the sheets).
    await refreshDaySheets(targets);
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
    const done = `Documents saved for ${saved} of ${count}.${missing > 0 ? ` ${missing} could not be found in My Tenders.` : ''}`;
    // Inside a live search the sign-in carries on; the run asks "What next?" again.
    if (options.inSession) options.inSession(done);
    else emitJobUpdate(update({ jobState: 'COMPLETE', phase: 'PUBLISHING', outcome: 'SUCCESS', statusMessage: done }));
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

// ── Daily report ─────────────────────────────────────────────────────────

/** Website totals older than this are read again after a Tamil Nadu run. */
const PUBLIC_COUNTS_MAX_AGE_MS = 6 * 3_600_000;
let publicCountsReading: Promise<void> | null = null;

/** Reads a GePNIC website's public organisation lists and records tenders published per day. */
function refreshPublicCounts(portal: PortalDefinition): Promise<void> {
  if (isGemPortal(portal)) return Promise.resolve();
  if (publicCountsReading) return publicCountsReading;
  publicCountsReading = countPublishedTenders(portal.url, { pause: () => new Promise((resolve) => setTimeout(resolve, 1_200)) })
    .then((counts) => {
      const at = new Date().toISOString();
      for (const [date, total] of counts.byDate) dailyCounts.record(portal.id, date, total, 'PUBLIC_LIST', null, at);
    })
    .finally(() => { publicCountsReading = null; });
  return publicCountsReading;
}

ipcMain.handle('get-daily-report', (_event, portalId: unknown, from: unknown, to: unknown): DailyReportView => {
  const portal = getPortalDefinition(typeof portalId === 'string' ? portalId : DEFAULT_PORTAL_ID);
  if (typeof from !== 'string' || typeof to !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Choose the days to report on.');
  const gem = isGemPortal(portal);
  const runs: ReportRun[] = jobs.listAll().flatMap((job) => {
    if (job.purpose && job.purpose !== 'SEARCH') return [];
    const config = runConfigurations.getForJob(job.id);
    if (!config || config.portalId !== portal.id || config.searchDate < from || config.searchDate > to) return [];
    return [{
      date: config.searchDate,
      at: job.created_at,
      finished: job.state === 'COMPLETE',
      // GeM names its own categories on each bid; Tamil Nadu is searched one chosen category at a time.
      categoriesSearched: gem ? [] : searches.listForJob(job.id).map((search) => search.product_category),
      // A GeM run lists every bid that started that day; its category check (G2) says which are the office's.
      listsWholeWebsite: gem,
      tenders: tenders.listForJob(job.id).map((tender) => ({
        key: tender.tender_portal_id ?? tender.tender_ref,
        category: tender.product_category ?? '',
        verdict: (workflow.getReview(tender.id)?.decision ?? classifications.getFinalForTender(tender.id)) as ReportTender['verdict'],
        approved: isApprovedTender(tender),
        inCategory: !gem || classifications.listForTender(tender.id).some((gate) => gate.gate === 'G2' && gate.result === 'PASS'),
      })),
    }];
  });
  const counts = dailyCounts.list(portal.id, from, to).map((count) => ({ date: count.published_date, total: count.total_published, categories: count.categories, readAt: count.read_at }));
  return {
    ...buildDailyReport(from, to, runs, counts),
    portalId: portal.id,
    gem,
    totalsReadAt: dailyCounts.lastReadAt(portal.id),
    totalsReading: publicCountsReading !== null,
    gemProductsIncluded: gem ? runConfigurations.getDefaults().gemIncludeProducts : undefined,
  };
});

/**
 * The tenders behind a number in the daily report: one category (or "Other
 * categories") over a day or a range of days, each once, newest day first.
 */
ipcMain.handle('get-report-tenders', (_event, portalId: unknown, from: unknown, to: unknown, category: unknown): ReportTenderItem[] => {
  const portal = getPortalDefinition(typeof portalId === 'string' ? portalId : DEFAULT_PORTAL_ID);
  if (typeof from !== 'string' || typeof to !== 'string' || typeof category !== 'string') throw new Error('Choose a category and days.');
  const gem = isGemPortal(portal);
  const screening = new Map(opportunities.listAllWithScreening().map((row) => [row.id, row]));
  const seen = new Map<string, ReportTenderItem>();
  const runsInRange = jobs.listAll()
    .filter((job) => !job.purpose || job.purpose === 'SEARCH')
    .map((job) => ({ job, config: runConfigurations.getForJob(job.id) }))
    .filter(({ config }) => config && config.portalId === portal.id && config.searchDate >= from && config.searchDate <= to)
    .sort((a, b) => b.job.created_at.localeCompare(a.job.created_at));
  for (const { job, config } of runsInRange) {
    for (const tender of tenders.listForJob(job.id)) {
      const key = tender.tender_portal_id ?? tender.tender_ref;
      if (seen.has(key) || !tender.opportunity_id) continue;
      const verdict = (workflow.getReview(tender.id)?.decision ?? classifications.getFinalForTender(tender.id)) as ReportTenderItem['verdict'];
      const approved = isApprovedTender(tender);
      const inCategory = !gem || classifications.listForTender(tender.id).some((gate) => gate.gate === 'G2' && gate.result === 'PASS');
      const name = tender.product_category || 'Not stated';
      const matches = category === 'Other categories'
        ? gem && !inCategory && verdict !== 'KEEP' && !approved
        : name === category;
      if (!matches) continue;
      const row = screening.get(tender.opportunity_id);
      seen.set(key, {
        opportunityId: tender.opportunity_id,
        tenderId: key,
        title: tender.title,
        date: config!.searchDate,
        closingDate: row?.closing_date ?? tender.closing_date,
        verdict,
        approved,
        lifecycle: row?.lifecycle ?? null,
        reason: row ? explainScreening(row.recommendation, parseScreenedGates(row.screening_json)).sentence : '',
      });
    }
  }
  return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
});

/** One tender's summary, to open its file from anywhere (the daily report). */
ipcMain.handle('get-tender-summary', (_event, opportunityId: unknown): TenderSummary => {
  const row = opportunities.listAllWithScreening().find((entry) => entry.id === opportunityId);
  if (!row) throw new Error('Tender not found.');
  return summarizeTender(row);
});

ipcMain.handle('refresh-website-totals', async (_event, portalId: unknown): Promise<void> => {
  const portal = getPortalDefinition(typeof portalId === 'string' ? portalId : DEFAULT_PORTAL_ID);
  if (isGemPortal(portal)) throw new Error('GeM totals are recorded by each GeM search; search a day to fill it in.');
  await refreshPublicCounts(portal);
});

/** How many tenders on this website are followed for extensions and corrigenda. */
ipcMain.handle('get-followed-tenders', (_event, portalId: unknown): { followed: number } => {
  const portal = getPortalDefinition(typeof portalId === 'string' ? portalId : DEFAULT_PORTAL_ID);
  return { followed: watchedTenderRows(portal.id).length };
});

/** "Check for changes": sign in, reopen the followed tenders, record extensions and corrigenda, and finish. */
ipcMain.handle('start-change-check', async (_event, portalId: unknown) => {
  const requested = getPortalDefinition(typeof portalId === 'string' ? portalId : DEFAULT_PORTAL_ID);
  if (isGemPortal(requested)) return startGemChangeCheck(requested);
  const { abortController, paceAction } = claimRun();
  let ctx: RunContext;
  let targets: TenderRow[];
  let credentials: PortalCredentials | undefined;
  try {
    const portal = getPortalDefinition(typeof portalId === 'string' ? portalId : DEFAULT_PORTAL_ID);
    targets = watchedTenderRows(portal.id);
    if (targets.length === 0) throw new Error('No tender is followed on this website yet: approve one, mark it for later, or leave it waiting for your decision.');
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
      jobs.markChangeCheck(signInUpdate.jobId, targets.map((tender) => tender.id));
      activeJobId = signInUpdate.jobId;
      ctx.jobId = signInUpdate.jobId;
      resolveStarted(signInUpdate.jobId);
    }
    emitJobUpdate(signInUpdate);
  }).then(async (signedIn) => {
    if (signedIn.outcome !== 'SUCCESS' || !ctx.page) return;
    await runChangeCheck(ctx, signedIn.jobId, signedIn.authSessionId);
  });
  activeJobCompletion = finishRun(ctx, run, rejectStarted);
  return { jobId: await started, count: targets.length };
});

/** GeM's check for changes: no sign-in, the followed bids are read from GeM's list. */
async function startGemChangeCheck(portal: PortalDefinition): Promise<{ jobId: string; count: number }> {
  const { abortController, paceAction } = claimRun();
  let ctx: RunContext;
  let targets: TenderRow[];
  try {
    targets = watchedTenderRows(portal.id);
    if (targets.length === 0) throw new Error('No GeM bid is followed yet: approve one, mark it for later, or leave it waiting for your decision.');
    const outputSettings = publishingSettings.get(portal.id);
    const config: RunConfiguration = { ...runConfigurations.getDefaults(), portalId: portal.id, searchDate: new Date().toLocaleDateString('en-CA') };
    const gem = gemClientFor(abortController.signal);
    ctx = { portal, config, outputSettings, abortController, paceAction, gem };
    activeRunPortalId = portal.id;
    await checkReadiness(portal, outputSettings);
  } catch (error) {
    releaseRun(abortController);
    throw error;
  }
  const job = jobs.create();
  jobs.markChangeCheck(job.id, targets.map((tender) => tender.id));
  runConfigurations.saveForJob(job.id, ctx.config);
  jobMachine.transition(job.id, 'AUTH_REQUIRED', 'GeM check for changes');
  jobMachine.transition(job.id, 'AUTH_PENDING', 'GeM needs no sign-in');
  jobMachine.transition(job.id, 'AUTHENTICATED', 'GeM lists are public');
  activeJobId = job.id;
  ctx.jobId = job.id;
  activeJobCompletion = finishRun(ctx, runChangeCheck(ctx, job.id, ''), () => {});
  return { jobId: job.id, count: targets.length };
}

async function runChangeCheck(ctx: RunContext, jobId: string, authSessionId: string): Promise<void> {
  const update = (extra: Partial<AuthJobUpdate> = {}): AuthJobUpdate => ({
    jobId, authSessionId,
    jobState: jobs.getById(jobId)!.state,
    authState: sessions.getById(authSessionId)?.state ?? 'AUTHENTICATED',
    phase: 'ACQUISITION',
    ...extra,
  });
  try {
    jobMachine.transition(jobId, 'ACQUIRING_DOCUMENTS', 'checking followed tenders for extensions and corrigenda');
    const report = (statusMessage: string) => emitJobUpdate(update({ statusMessage }));
    const summary = isGemPortal(ctx.portal) ? await checkWatchedGemBids(ctx, jobId, report, true) : await checkWatchedTenders(ctx, jobId, authSessionId, report, true);
    if (ctx.abortController.signal.aborted) throw new Error(USER_CANCELLED_REASON);
    if (authSessionId && sessionWasLost(authSessionId)) {
      endJob(jobId, 'portal signed out while checking followed tenders');
      emitJobUpdate(update({ jobState: jobs.getById(jobId)!.state, outcome: 'ABORTED', abortReason: 'The website signed you out part-way. What was checked is saved; check again to finish the rest.' }));
      return;
    }
    for (const [state, reason] of [
      ['DOCUMENTS_LOCAL', 'followed tenders checked'],
      ['PROCESSING_DOCUMENTS', 'check for changes finishing'],
      ['EXTRACTING_REQUIREMENTS', 'no requirement extraction in a check for changes'],
      ['UPLOADING', 'changed approved tenders copied to Drive'],
      ['REPORTING', 'check for changes reporting'],
    ] as const) jobMachine.transition(jobId, state, reason);
    const message = describeWatch(summary) || 'No followed tender could be checked.';
    jobMachine.transition(jobId, 'COMPLETE', `check for changes complete: ${message}`);
    emitJobUpdate(update({ jobState: 'COMPLETE', phase: 'PUBLISHING', outcome: 'SUCCESS', statusMessage: message }));
  } catch (error) {
    if (ctx.abortController.signal.aborted) {
      markJobCancelled(jobs, jobMachine, jobId);
      emitJobUpdate(update({ jobState: jobs.getById(jobId)!.state, outcome: 'ABORTED', abortReason: USER_CANCELLED_REASON }));
      return;
    }
    endJob(jobId, 'check for changes failed');
    emitJobUpdate(update({ jobState: jobs.getById(jobId)!.state, outcome: 'ABORTED', abortReason: error instanceof Error ? error.message : String(error) }));
  }
}

ipcMain.handle('start-job', (_event, requestedConfig: RunConfiguration, untilDate?: unknown, options?: { runAgain?: unknown }) =>
  startSearch(requestedConfig, untilDate, options));

/** Sign in (or not, for GeM) and search the planned dates; resolves once the run has its job id. */
async function startSearch(requestedConfig: RunConfiguration, untilDate?: unknown, options?: { runAgain?: unknown }) {
  const { abortController, paceAction } = claimRun();
  let ctx: RunContext;
  let plan: DateBatchPlan;
  let savedPortalCredentials: PortalCredentials | undefined;
  try {
    const config = normalizeRunConfiguration(requestedConfig);
    const portal = getPortalDefinition(config.portalId);
    config.portalId = portal.id;
    let until = typeof untilDate === 'string' && untilDate ? untilDate : config.searchDate;
    if (config.dateMeaning === 'CLOSING_AFTER') {
      // A catch-up search is one search, on the day it runs, of every bid closing from closingFrom on.
      if (!isGemPortal(portal)) throw new Error('Searching by time to prepare is for GeM only.');
      config.searchDate = until = new Date().toLocaleDateString('en-CA');
      if (!config.closingFrom || config.closingFrom < config.searchDate) throw new Error('Choose an earliest closing date from today onwards.');
    } else {
      config.dateMeaning = checkDateMeaning(portal, config.dateMeaning, config.searchDate, until);
    }
    plan = config.dateMeaning === 'CLOSING_AFTER'
      ? { toRun: [config.searchDate], skipped: [] }
      : planDatesToRun(portal.id, config.searchDate, until, options?.runAgain === true, config.dateMeaning);
    config.searchDate = plan.toRun[0];
    const outputSettings = publishingSettings.get(portal.id);
    ctx = { portal, config, outputSettings, abortController, paceAction };
    activeRunContext = ctx;
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
}

/**
 * Closing dates are GeM only, and today or later: GeM lists only bids still
 * open, so an earlier closing day has nothing left to find.
 */
function checkDateMeaning(portal: PortalDefinition, meaning: RunDateMeaning | undefined, from: string, to: string): RunDateMeaning {
  if (meaning !== 'CLOSING' || !isGemPortal(portal)) return 'PUBLISHED';
  const today = new Date().toLocaleDateString('en-CA');
  if (from < today || to < today) throw new Error('Choose closing dates from today onwards. GeM lists only bids that are still open.');
  return 'CLOSING';
}

/** The dates in a range still to run for a portal; throws when there are none. */
function planDatesToRun(portalId: string, from: string, to: string, runAgain = false, meaning: RunDateMeaning = 'PUBLISHED'): DateBatchPlan {
  // Run again: search dates already run too, e.g. after the screening improved.
  const plan = planDateBatch(from, to, runAgain ? [] : runConfigurations.listCompletedRunDates(portalId, meaning));
  if (plan.toRun.length === 0) {
    const kind = meaning === 'CLOSING' ? 'closing-date search' : 'completed run';
    throw new Error(from === to
      ? `${from} already has a ${kind} for this portal. Its tenders are in the Inbox and Tenders pages. Tick "Also search days already searched" to search it again.`
      : `Every date from ${from} to ${to} already has a ${kind} for this portal. Tick "Also search days already searched" to search them again.`);
  }
  return plan;
}

ipcMain.handle('run-more-dates', (_event, from: unknown, to: unknown, options?: { runAgain?: unknown }): DateBatchPlan => {
  if (!pendingMoreDates || !activeRunPortalId) throw new Error('The run is not waiting for more dates.');
  if (typeof from !== 'string' || typeof to !== 'string') throw new Error('Choose the published dates to run.');
  // Dates already run in this sign-in are never run twice; with "Run
  // again", dates from earlier runs are searched again.
  const queued = activeBatch?.dates ?? [];
  // More dates keep the run's own meaning: closing days in a closing-date run.
  const meaning = activeRunContext?.config.dateMeaning ?? 'PUBLISHED';
  if (meaning === 'CLOSING_AFTER') throw new Error('This search already covered every later closing day. Start a new search for other dates.');
  if (meaning === 'CLOSING') checkDateMeaning(getPortalDefinition(activeRunPortalId), meaning, from, to);
  const earlier = options?.runAgain === true ? [] : runConfigurations.listCompletedRunDates(activeRunPortalId, meaning);
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

// After the last date: search on another website. The current sign-in is
// finished (signed out, report shown) and the other website's run starts.
// Its dates are checked first, so a range with nothing to run leaves the
// current sign-in waiting as it was.
ipcMain.handle('switch-portal-run', async (_event, requestedConfig: RunConfiguration, untilDate?: unknown, options?: { runAgain?: unknown }) => {
  if (!pendingMoreDates) throw new Error('The run is not waiting for more dates.');
  const portal = getPortalDefinition(normalizeRunConfiguration(requestedConfig).portalId);
  if (portal.id === activeRunPortalId) throw new Error('That is the website already signed in. Choose its dates instead.');
  const requested = normalizeRunConfiguration(requestedConfig);
  const from = requested.searchDate;
  const until = typeof untilDate === 'string' && untilDate ? untilDate : from;
  planDatesToRun(portal.id, from, until, options?.runAgain === true, checkDateMeaning(portal, requested.dateMeaning, from, until));
  const completion = activeJobCompletion;
  pendingMoreDates(null);
  await completion;
  return startSearch(requestedConfig, untilDate, options);
});

// The menu bar is hidden by the frameless window; its commands (backup,
// restore, exports, about) open from the sidebar's More button.
ipcMain.handle('show-app-menu', (_event, x: unknown, y: unknown): void => {
  const menu = Menu.getApplicationMenu();
  if (!menu || !mainWindow) return;
  menu.popup({ window: mainWindow, x: typeof x === 'number' ? Math.round(x) : undefined, y: typeof y === 'number' ? Math.round(y) : undefined });
});

/** "Check for changes" while a run waits signed in: checks the followed tenders without signing in again. */
ipcMain.handle('check-changes-in-run', (): void => {
  if (!pendingMoreDates) throw new Error('The run is not waiting; check for changes once it has finished its dates.');
  pendingMoreDates({ toRun: [], skipped: [], checkChanges: true });
});

/** "Collect documents now" while a run waits signed in: approved tenders' files, no new sign-in. */
ipcMain.handle('collect-documents-in-run', (): void => {
  if (!pendingMoreDates) throw new Error('The run is not waiting; collect documents once it has finished its dates.');
  pendingMoreDates({ toRun: [], skipped: [], collectApproved: true });
});

/** "This search": every tender this sign-in found, with its verdict and why, to approve or reject on the spot. */
ipcMain.handle('get-live-session', (): LiveSessionView => {
  const ctx = activeRunContext;
  const jobIds = ctx?.sessionJobIds ?? [];
  const seen = new Map<string, LiveSessionTender>();
  const screening = new Map(opportunities.listAllWithScreening().map((row) => [row.id, row]));
  for (const jobId of jobIds) {
    for (const tender of tenders.listForJob(jobId)) {
      if (!tender.opportunity_id || seen.has(tender.opportunity_id)) continue;
      const row = screening.get(tender.opportunity_id);
      if (!row) continue;
      const explanation = explainScreening(row.recommendation, parseScreenedGates(row.screening_json));
      seen.set(row.id, {
        opportunityId: row.id,
        tenderId: row.tender_portal_id ?? row.tender_ref,
        title: row.title,
        organisation: (row.organisation_chain ?? '').split('||')[0]?.trim() || null,
        closingDate: row.closing_date,
        recommendation: row.recommendation,
        lifecycle: row.lifecycle,
        reason: explanation.sentence,
        filesSaved: tenders.listForOpportunity(row.id).some((sighting) => workflow.listDocuments(sighting.id).some((document) => document.state === 'DOWNLOADED')),
      });
    }
  }
  const portalId = ctx?.portal.id ?? DEFAULT_PORTAL_ID;
  return {
    tenders: [...seen.values()],
    approvedWaitingForDocuments: isGemPortal(getPortalDefinition(portalId)) ? 0 : approvedWaitingForDocuments(portalId).ready.length,
  };
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
    try { alignAllReviews(); } catch (error) { console.error('[TenderAssist] Could not line up saved reviews:', error); }
    createWindow();
    configureApplicationMenu();
    mainWindow?.webContents.once('did-finish-load', reportRestoreOutcome);
    configureUpdates(() => mainWindow);
    // The key: read the saved answer at once, ask the server soon after, then
    // every few hours; re-read hourly so a key that ends while open locks.
    void licence.view().then(noteLicence).then(() => licence.check()).then(() => pullSharedCategories());
    // Category changes other offices saw: hourly, so they arrive the same day.
    setInterval(() => { void pullSharedCategories(); }, 60 * 60 * 1000);
    setInterval(() => { void licence.check(); }, CHECK_EVERY_MS);
    setInterval(() => { void licence.view().then(noteLicence); }, 60 * 60 * 1000);
    if (app.isPackaged) {
      setTimeout(() => {
        void checkForUpdates(() => mainWindow).catch(() => {
          // checkForUpdates already records the recoverable failure in the
          // renderer-facing update status. Startup must never fail because
          // the release feed is unavailable.
        });
      }, 5000);
      // Offices leave TenderAssist open all day: look for a new version every 4 hours, so it arrives the same day.
      setInterval(() => {
        const state = getUpdateStatus().state;
        if (state !== 'READY' && state !== 'DOWNLOADING') void checkForUpdates(() => mainWindow).catch(() => {});
      }, 4 * 60 * 60 * 1000);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
