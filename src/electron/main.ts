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

  const profileDir = join(getAppDataDir(), 'chrome-profile');
  mkdirSync(profileDir, { recursive: true });
  const cdpPort = 9222 + Math.floor(Math.random() * 5000);
  launchChrome({ userDataDir: profileDir, cdpPort });
  await waitForCdpReady(cdpPort, 15000);

  // The `!` tells TypeScript this will definitely be assigned before use --
  // true here because the Promise executor runs synchronously, but that
  // fact isn't visible to TS's control-flow analysis across the closure.
  let resolveStarted!: (jobId: string) => void;
  const started = new Promise<string>((resolve) => {
    resolveStarted = resolve;
  });

  const runPromise = runAuthJob(
    { jobs, sessions, jobMachine, authMachine },
    `http://127.0.0.1:${cdpPort}`,
    PORTAL_URL,
    (update) => {
      if (activeJobId === null) {
        activeJobId = update.jobId;
        resolveStarted(update.jobId);
      }
      mainWindow?.webContents.send('job-updated', update);
    }
  );

  // runAuthJob only ever RESOLVES (with a terminal SUCCESS/TIMEOUT/ABORTED
  // AuthJobUpdate) -- a rejection here means something broke outside its own
  // control loop (e.g. Chrome crashed). Surface it instead of letting it
  // become an unhandled rejection, since nothing else awaits this promise.
  runPromise.catch((err) => {
    console.error('runAuthJob failed unexpectedly:', err);
  });
  runPromise.finally(() => {
    activeJobId = null;
  });

  const jobId = await started;
  return { jobId };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
