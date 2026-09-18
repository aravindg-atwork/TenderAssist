// src/electron/main.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createDatabase } from '../persistence/db.js';
import { runMigrations } from '../persistence/migrate.js';
import { JobRepository } from '../persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../persistence/repositories/stateTransitionRepository.js';
import { JobStateMachine } from '../state/jobStateMachine.js';
import { AuthStateMachine } from '../state/authStateMachine.js';
import { getDatabasePath, getAppDataDir } from '../config/paths.js';
import { launchChrome, waitForCdpReady } from '../browser/chromeLauncher.js';
import { runAuthJob } from '../orchestration/authJobRunner.js';
import type { JobListItem, JobDetail } from './ipcTypes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = createDatabase(getDatabasePath());
runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
const jobs = new JobRepository(db);
const sessions = new AuthSessionRepository(db);
const transitions = new StateTransitionRepository(db);
const jobMachine = new JobStateMachine(db, jobs, transitions);
const authMachine = new AuthStateMachine(db, sessions, transitions);

const PORTAL_URL = 'https://tntenders.gov.in/nicgep/app';

let mainWindow: BrowserWindow | undefined;
let activeJobId: string | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  void mainWindow.loadFile(join(__dirname, '..', '..', 'renderer', 'dist', 'index.html'));
}

ipcMain.handle('list-jobs', (): JobListItem[] => {
  return jobs.listAll().map((job) => {
    const session = sessions.getLatestForJob(job.id);
    return {
      jobId: job.id,
      jobState: job.state,
      authState: session?.state ?? null,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    };
  });
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
  };
});

ipcMain.handle('start-job', async () => {
  if (activeJobId) {
    throw new Error('A job is already running. Wait for it to finish before starting another.');
  }
  activeJobId = 'pending'; // synchronous claim -- closes the guard atomically, before any await

  const profileDir = join(getAppDataDir(), 'chrome-profile');
  mkdirSync(profileDir, { recursive: true });
  const cdpPort = 9222 + Math.floor(Math.random() * 5000);
  let chromeProc: ReturnType<typeof launchChrome>;
  try {
    chromeProc = launchChrome({ userDataDir: profileDir, cdpPort, startUrl: PORTAL_URL });
    await waitForCdpReady(cdpPort, 15000);
  } catch (err) {
    // Making the guard atomic means WE now own resetting it on early failure --
    // without this, a launch failure would permanently lock out all future jobs.
    activeJobId = null;
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
  const runPromise = runAuthJob(
    { jobs, sessions, jobMachine, authMachine },
    `http://127.0.0.1:${cdpPort}`,
    PORTAL_URL,
    (update) => {
      if (!jobIdCaptured) {
        jobIdCaptured = true;
        activeJobId = update.jobId;
        resolveStarted(update.jobId);
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('job-updated', update);
    }
  );

  // runAuthJob only ever RESOLVES (with a terminal SUCCESS/TIMEOUT/ABORTED
  // AuthJobUpdate) -- a rejection here means something broke outside its own
  // control loop (e.g. Chrome crashed). Surface it instead of letting it
  // become an unhandled rejection, since nothing else awaits this promise. It
  // also rejects `started` -- a silent no-op if `started` already resolved,
  // but load-bearing if runAuthJob fails before its first onUpdate call.
  runPromise
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
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('job-updated', {
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
    .finally(() => {
      activeJobId = null;
      // Release the Chrome profile lock now that this job's run has settled --
      // without this, the NEXT start-job launches a Chrome that can't bind its
      // own CDP port (Chrome forwards to the already-running instance and
      // silently ignores --remote-debugging-port), and waitForCdpReady hangs
      // 15s before throwing a confusing error.
      if (chromeProc.pid) {
        try {
          process.kill(chromeProc.pid);
        } catch {
          // already exited
        }
      }
    });

  const jobId = await started;
  return { jobId };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
