// src/electron/main.ts
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, type MenuItemConstructorOptions } from 'electron';
import { join, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { createDatabase, withTransaction } from '../persistence/db.js';
import { runMigrations } from '../persistence/migrate.js';
import { JobRepository } from '../persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../persistence/repositories/stateTransitionRepository.js';
import { SearchRepository } from '../persistence/repositories/searchRepository.js';
import { TenderRepository } from '../persistence/repositories/tenderRepository.js';
import { RunConfigurationRepository } from '../persistence/repositories/runConfigurationRepository.js';
import { ClassificationRepository } from '../persistence/repositories/classificationRepository.js';
import { PortalCredentialRepository } from '../persistence/repositories/portalCredentialRepository.js';
import { PublishingSettingsRepository } from '../persistence/repositories/publishingSettingsRepository.js';
import { AutomationSettingsRepository } from '../persistence/repositories/automationSettingsRepository.js';
import { TenderWorkflowRepository, type ManualTenderDecision } from '../persistence/repositories/tenderWorkflowRepository.js';
import { JobOutputRepository } from '../persistence/repositories/jobOutputRepository.js';
import { OpportunityRepository } from '../persistence/repositories/opportunityRepository.js';
import { applyTenderDecision, recordCollectedDocuments, recordDownloadSelection, syncJobOpportunities } from '../orchestration/opportunitySync.js';
import { JobStateMachine } from '../state/jobStateMachine.js';
import { AuthStateMachine } from '../state/authStateMachine.js';
import { getDatabasePath, getAppDataDir } from '../config/paths.js';
import { waitForCdpReady } from '../browser/chromeLauncher.js';
import { runAuthJob } from '../orchestration/authJobRunner.js';
import { runSearchPhase } from '../orchestration/searchPhaseRunner.js';
import { runClassificationPhase } from '../orchestration/classificationPhaseRunner.js';
import { runPostProcessing } from '../orchestration/postProcessingRunner.js';
import { attemptLogout } from '../browser/logoutController.js';
import type { Page } from 'playwright-core';
import type {
  JobListItem,
  JobDetail,
  RunSettingsState,
  PortalCredentialSettings,
  SavePortalCredentialInput,
  AuthJobUpdate,
} from './ipcTypes.js';
import { normalizeRunConfiguration, type RunConfiguration } from '../config/runConfiguration.js';
import type { PortalCredentials } from '../browser/portalLoginController.js';
import { isValidJnlpFile, type DscJnlpArtifact } from '../browser/dscDownloadSecurity.js';
import { localDateFromTimestamp, mirrorJobOutputToDrive, publishJobWorkbook } from '../publishing/jobPublisher.js';
import { checkForUpdates, configureUpdates, getUpdateStatus, restartToInstall } from './updateService.js';
import { runPreflight } from '../system/preflight.js';
import { EmbeddedPortalHost, embeddedPortalTargetPrefix } from './embeddedPortalHost.js';
import { markJobCancelled, USER_CANCELLED_REASON } from '../orchestration/jobCancellation.js';
import { createActionPacer } from '../orchestration/actionPacer.js';
import { DEFAULT_PORTAL_ID, getPortalDefinition } from '../config/portalRegistry.js';

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
const db = createDatabase(getDatabasePath());
runMigrations(db, join(app.getAppPath(), 'src', 'persistence', 'migrations'));
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
const jobOutputs = new JobOutputRepository(db);
const opportunities = new OpportunityRepository(db);
const opportunitySync = { tenders, classifications, opportunities, workflow };

// Tender records are a view over run data; a failure to update them must
// never fail the run itself, so report and carry on.
function syncOpportunities(label: string, fn: () => void): void {
  try { fn(); } catch (error) { console.error(`[TenderAssist] tender record sync failed (${label}):`, error); }
}
syncOpportunities('expiry sweep', () => opportunities.expireOverdue());
const jobMachine = new JobStateMachine(db, jobs, transitions);
const authMachine = new AuthStateMachine(db, sessions, transitions);

let mainWindow: BrowserWindow | undefined;
let portalHost: EmbeddedPortalHost | undefined;
let activeJobId: string | null = null;
let activeJobAbortController: AbortController | undefined;
let activeStopWatchingSessionLoss: (() => void) | undefined;
let activeJobCompletion: Promise<unknown> | undefined;
let lastActiveJobUpdate: AuthJobUpdate | undefined;
const dscDownloadDirectory = join(getAppDataDir(), 'dsc-downloads');
const dscArtifacts = new Map<string, DscJnlpArtifact>();
const pendingDocumentSelections = new Map<string, (tenderIds: string[]) => void>();

// Pauses the job right after shortlisting (job state stays SHORTLISTED) so
// the renderer's review panel can show live certain/needs-review counts and
// let the user tick which tenders to actually download, OCR/extract, and
// publish an eligibility sheet for -- rather than acquiring documents for
// every automatic KEEP the instant classification finishes. Resolves with
// null if the job is cancelled while still waiting on that human choice.
function waitForDocumentSelection(jobId: string, signal: AbortSignal): Promise<string[] | null> {
  return new Promise((resolve) => {
    const onAbort = () => {
      pendingDocumentSelections.delete(jobId);
      resolve(null);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    pendingDocumentSelections.set(jobId, (tenderIds) => {
      signal.removeEventListener('abort', onAbort);
      pendingDocumentSelections.delete(jobId);
      resolve(tenderIds);
    });
  });
}

function emitJobUpdate(update: AuthJobUpdate): void {
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
    minWidth: 980,
    minHeight: 680,
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

function navigateApplication(view: 'jobs' | 'settings', section?: 'folders'): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('app-navigate', { view, section });
}

function configureApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Output folders and naming…', accelerator: 'CmdOrCtrl+Shift+O', click: () => navigateApplication('settings', 'folders') },
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
        { label: 'Show Jobs', accelerator: 'CmdOrCtrl+1', click: () => navigateApplication('jobs') },
        { label: 'Show Settings', accelerator: 'CmdOrCtrl+2', click: () => navigateApplication('settings') },
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
  const settings = publishingSettings.get(config.portalId ?? DEFAULT_PORTAL_ID);
  const numbered = items.map((item) => ({ ...item, serialNumber: jobOutputs.serialNumberFor(plan, item.tender.id) }));
  return publishJobWorkbook(plan.outputRoot, plan.outputDate, jobId, numbered, plan.structure, plan.runNumber).then((published) => {
    mirrorJobOutputToDrive(published.jobDirectory, settings.driveOutputRoot, plan.outputDate, jobId, plan.structure);
    return published;
  });
}

// Jobs published before output plans existed get one from today's settings
// on first use; after that the plan is frozen.
function outputPlanFor(jobId: string, portalId?: string) {
  const job = jobs.getById(jobId);
  if (!job) throw new Error('Job not found.');
  const settings = publishingSettings.get(portalId ?? DEFAULT_PORTAL_ID);
  return jobOutputs.getOrCreatePlan(jobId, settings.localOutputRoot, localDateFromTimestamp(job.created_at), settings.structure);
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
  return review;
});

ipcMain.handle('get-recovery-job', () => {
  const job = jobs.findIncomplete();
  if (!job || job.id === activeJobId) return null;
  const config = runConfigurations.getForJob(job.id);
  return config ? { jobId: job.id, state: job.state, config } : null;
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
  const openError = await shell.openPath(target);
  if (openError) throw new Error(`Could not launch the DSC signer: ${openError}`);
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

ipcMain.handle('confirm-document-selection', (_event, jobId: string, tenderIds: string[]): void => {
  if (!jobId || activeJobId !== jobId) throw new Error('This job is no longer running.');
  const resolve = pendingDocumentSelections.get(jobId);
  if (!resolve) throw new Error('This job is not waiting for a tender selection.');
  resolve(Array.isArray(tenderIds) ? tenderIds : []);
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

ipcMain.handle('start-job', async (_event, requestedConfig: RunConfiguration) => {
  if (activeJobId) {
    throw new Error('A job is already running. Wait for it to finish before starting another.');
  }
  activeJobId = 'pending'; // synchronous claim -- closes the guard atomically, before any await
  const abortController = new AbortController();
  const paceAction = createActionPacer(automationSettings.get(), abortController.signal);
  activeJobAbortController = abortController;
  activeStopWatchingSessionLoss = undefined;
  lastActiveJobUpdate = undefined;

  let config: RunConfiguration;
  let savedPortalCredentials: PortalCredentials | undefined;
  let portal = getPortalDefinition(DEFAULT_PORTAL_ID);
  let outputSettings = publishingSettings.get(DEFAULT_PORTAL_ID);
  try {
    config = normalizeRunConfiguration(requestedConfig);
    portal = getPortalDefinition(config.portalId);
    config.portalId = portal.id;
    outputSettings = publishingSettings.get(portal.id);
    const preflight = await runPreflight(outputSettings.localOutputRoot, portal.url, portal.name, outputSettings.driveOutputRoot);
    const blocker = preflight.checks.find((check) => check.level === 'BLOCKED');
    if (blocker) throw new Error(blocker.message);
    if (!runConfigurations.hasSavedDefaults()) {
      throw new Error('Save your product categories and intent in Settings before starting a job.');
    }
    savedPortalCredentials = await loadPortalCredentials(portal.id);
  } catch (error) {
    activeJobId = null;
    activeJobAbortController = undefined;
    throw error;
  }

  // Append a local-midnight time so "YYYY-MM-DD" parses as the calendar day
  // the person actually picked, not UTC midnight (which rolls back a day in
  // any timezone ahead of UTC).
  const searchDate = new Date(`${config.searchDate}T00:00:00`);
  const configuredSearches = config.productCategories.map((productCategory, index) => ({
    searchKey: `search_${index + 1}`,
    productCategory,
  }));

  try {
    portalHost?.close();
    portalHost = new EmbeddedPortalHost(() => mainWindow, dscDownloadDirectory, portal);
    await portalHost.open(portal.url);
    await waitForCdpReady(EMBEDDED_CDP_PORT, 15000);
  } catch (err) {
    // Making the guard atomic means WE now own resetting it on early failure --
    // without this, a launch failure would permanently lock out all future jobs.
    activeJobId = null;
    activeJobAbortController = undefined;
    portalHost?.close();
    throw err;
  }

  // The `!` tells TypeScript this will definitely be assigned before use --
  // true here because the Promise executor runs synchronously, but that
  // fact isn't visible to TS's control-flow analysis across the closure.
  let resolveStarted!: (jobId: string) => void;
  let rejectStarted!: (err: unknown) => void;
  const started = new Promise<string>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });

  let jobIdCaptured = false;
  let capturedPage: Page | undefined;
  let stopWatchingSessionLoss: (() => void) | undefined;

  const runPromise = runAuthJob(
    {
      jobs,
      sessions,
      jobMachine,
      authMachine,
      portalCredentials: savedPortalCredentials,
      targetUrlPrefix: embeddedPortalTargetPrefix(portal),
      registerDscReady: (listener) => portalHost!.onDscReady(listener),
      onDscJnlpReady: (jobId, artifact) => dscArtifacts.set(jobId, artifact),
      signal: abortController.signal,
      paceAction,
    },
    `http://127.0.0.1:${EMBEDDED_CDP_PORT}`,
    portal.url,
    (update) => {
      if (!jobIdCaptured) {
        jobIdCaptured = true;
        activeJobId = update.jobId;
        runConfigurations.saveForJob(update.jobId, config);
        resolveStarted(update.jobId);
      }
      emitJobUpdate(update);
    },
    (page, stop) => {
      capturedPage = page;
      stopWatchingSessionLoss = stop;
      activeStopWatchingSessionLoss = stop;
    }
  )
  .then(async (authResult) => {
    if (authResult.outcome !== 'SUCCESS' || !capturedPage) return authResult;

    return runSearchPhase(
      { jobs, sessions, jobMachine, searches, tenders, classifications, signal: abortController.signal, paceAction },
      capturedPage,
      authResult.jobId,
      authResult.authSessionId,
      (update) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('job-updated', update);
      },
      searchDate,
      configuredSearches,
      { keywords: config.keywords, excludedKeywords: config.excludedKeywords }
    );
  })
  .then(async (searchResult) => {
    // Record what the run saw even if the search stopped part-way.
    syncOpportunities('search', () => syncJobOpportunities(opportunitySync, searchResult.jobId, portal.id, { screening: false }));
    if (searchResult.phase !== 'SEARCH' || searchResult.outcome !== 'SUCCESS' || !capturedPage) {
      return searchResult;
    }
    return runClassificationPhase(
      { jobs, sessions, jobMachine, tenders, classifications, signal: abortController.signal, paceAction },
      capturedPage,
      searchResult.jobId,
      searchResult.authSessionId,
      config,
      (update) => {
        emitJobUpdate(update);
      },
      portal.stateName
    );
  })
  .then(async (classificationResult) => {
    syncOpportunities('classification', () => syncJobOpportunities(opportunitySync, classificationResult.jobId, portal.id, { screening: classificationResult.outcome === 'SUCCESS' }));
    if (classificationResult.phase !== 'CLASSIFICATION' || classificationResult.outcome !== 'SUCCESS' || !capturedPage) {
      return classificationResult;
    }
    // Job sits in SHORTLISTED here -- the renderer shows the review panel
    // and waits for the user to tick tenders and confirm before anything
    // downloads. cancel-job aborts this wait too (see waitForDocumentSelection).
    const selectedTenderIds = await waitForDocumentSelection(classificationResult.jobId, abortController.signal);
    if (selectedTenderIds === null) return classificationResult;
    syncOpportunities('selection', () => recordDownloadSelection(opportunitySync, classificationResult.jobId, selectedTenderIds));
    const postProcessingResult = await runPostProcessing(
      { jobs, sessions, jobMachine, tenders, classifications, workflow, outputs: jobOutputs, signal: abortController.signal },
      capturedPage,
      classificationResult.jobId,
      classificationResult.authSessionId,
      config,
      outputSettings.localOutputRoot,
      (update) => {
        emitJobUpdate(update);
      },
      outputSettings.driveOutputRoot,
      portal.url,
      selectedTenderIds,
      outputSettings.structure
    );
    syncOpportunities('documents', () => recordCollectedDocuments(opportunitySync, classificationResult.jobId));
    return postProcessingResult;
  });

  // runAuthJob only ever RESOLVES (with a terminal SUCCESS/TIMEOUT/ABORTED
  // AuthJobUpdate) -- a rejection here means something broke outside its own
  // control loop (e.g. Chrome crashed). Surface it instead of letting it
  // become an unhandled rejection, since nothing else awaits this promise. It
  // also rejects `started` -- a silent no-op if `started` already resolved,
  // but load-bearing if runAuthJob fails before its first onUpdate call.
  const completionPromise = runPromise
    .catch((err) => {
      console.error('runAuthJob failed unexpectedly:', err);
      rejectStarted(err); // no-op if `started` already resolved
      if (jobIdCaptured) {
        // A rejection after the first onUpdate means the job genuinely died
        // mid-run with no terminal AuthJobUpdate ever pushed -- without this,
        // the UI has no way to learn the job is dead and stays stuck showing
        // it as still running indefinitely.
        const failedJobId = activeJobId;
        if (failedJobId && failedJobId !== 'pending') {
          const job = jobs.getById(failedJobId);
          const session = sessions.getLatestForJob(failedJobId);
          if (!abortController.signal.aborted) {
            emitJobUpdate({
              jobId: failedJobId,
              authSessionId: session?.id ?? '',
              jobState: job?.state ?? 'FAILED_MANUAL',
              authState: session?.state ?? 'TAB_LOST',
              outcome: 'ABORTED',
              abortReason: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    })
    .finally(async () => {
      stopWatchingSessionLoss?.();
      // Clean, server-side logout before closing the embedded portal -- best
      // effort only (attemptLogout swallows its own failures).
      if (capturedPage) {
        await attemptLogout(capturedPage);
      }
      portalHost?.close();
      if (activeJobAbortController === abortController) {
        activeJobId = null;
        activeJobAbortController = undefined;
        activeStopWatchingSessionLoss = undefined;
        activeJobCompletion = undefined;
        lastActiveJobUpdate = undefined;
      }
    });
  activeJobCompletion = completionPromise;

  const jobId = await started;
  return { jobId };
});

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    configureApplicationMenu();
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
