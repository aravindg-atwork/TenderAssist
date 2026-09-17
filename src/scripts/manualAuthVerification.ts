import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createDatabase } from '../persistence/db.js';
import { runMigrations } from '../persistence/migrate.js';
import { JobRepository } from '../persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../persistence/repositories/stateTransitionRepository.js';
import { AuthStateMachine } from '../state/authStateMachine.js';
import { JobStateMachine } from '../state/jobStateMachine.js';
import { launchChrome, waitForCdpReady } from '../browser/chromeLauncher.js';
import { AuthFlow } from '../browser/authFlow.js';
import { getDatabasePath, getAppDataDir } from '../config/paths.js';
import { logger } from '../observability/logger.js';

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 5 * 60 * 1000;
// Randomized like the test files' own CDP ports, rather than a fixed 9222:
// a fixed port risks silently attaching to a stale/unrelated Chrome instance
// left over from a previous run or another tool, which would produce a false
// SUCCESS/failure on the one manual run that's supposed to be authoritative.
const CDP_PORT = 9222 + Math.floor(Math.random() * 5000);

async function main(): Promise<void> {
  const portalUrl = process.argv[2];
  if (!portalUrl) {
    console.error('Usage: node dist/scripts/manualAuthVerification.js <PORTAL_LOGIN_URL>');
    process.exit(1);
  }
  if (!/^https?:\/\//i.test(portalUrl)) {
    console.error(`Invalid portal URL: ${portalUrl} (must start with http:// or https://)`);
    process.exit(1);
  }

  const dbPath = getDatabasePath();
  const db = createDatabase(dbPath);
  runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));

  const jobs = new JobRepository(db);
  const sessions = new AuthSessionRepository(db);
  const transitions = new StateTransitionRepository(db);
  const jobMachine = new JobStateMachine(db, jobs, transitions);
  const authMachine = new AuthStateMachine(db, sessions, transitions);

  const job = jobs.create();
  jobMachine.transition(job.id, 'AUTH_REQUIRED', 'manual verification run');

  const profileDir = join(getAppDataDir(), 'chrome-profile');
  mkdirSync(profileDir, { recursive: true });

  console.log(`Launching Chrome (profile: ${profileDir})...`);
  launchChrome({ userDataDir: profileDir, cdpPort: CDP_PORT });
  await waitForCdpReady(CDP_PORT, 15000);

  const flow = new AuthFlow({ sessions, machine: authMachine });
  const { authSessionId } = await flow.start(job.id, `http://127.0.0.1:${CDP_PORT}`);
  jobMachine.transition(job.id, 'AUTH_PENDING', 'browser attached');

  await flow.getPage().goto(portalUrl);

  console.log('');
  console.log('Chrome is open. Complete login (and DSC authentication, if applicable) in that window.');
  console.log(`Polling for the authenticated-dashboard indicators every ${POLL_INTERVAL_MS / 1000}s, up to ${TIMEOUT_MS / 60000} minutes.`);
  console.log('');

  const deadline = Date.now() + TIMEOUT_MS;
  let outcome: 'SUCCESS' | 'TIMEOUT' | 'ABORTED' = 'TIMEOUT';
  let abortReason = '';

  while (Date.now() < deadline) {
    let authenticated: boolean;
    try {
      authenticated = await flow.checkAuthenticated();
    } catch (err) {
      // The retained page/tab can go away mid-check (e.g. the human closes
      // it, or it navigates away at the exact wrong instant), which would
      // otherwise surface as an uncaught Playwright rejection and a raw
      // stack trace instead of a clean, actionable report.
      outcome = 'ABORTED';
      abortReason = `checkAuthenticated() failed: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }

    if (authenticated) {
      outcome = 'SUCCESS';
      break;
    }

    // A terminal auth-session state (tab closed, or the page ended up
    // showing a session-expired indicator) will never become AUTHENTICATED
    // on a later poll -- stop early instead of silently polling out the
    // full remaining timeout with no chance of success.
    const state = sessions.getById(authSessionId)?.state;
    if (state === 'TAB_LOST' || state === 'SESSION_EXPIRED') {
      outcome = 'ABORTED';
      abortReason = `auth session reached terminal state ${state} before authentication was detected`;
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.log('');
  if (outcome === 'SUCCESS') {
    jobMachine.transition(job.id, 'AUTHENTICATED', 'auth flow confirmed dashboard indicators');
    console.log('SUCCESS: authenticated-dashboard indicators detected.');
    logger.info('manual auth verification succeeded', { jobId: job.id, authSessionId });
  } else if (outcome === 'ABORTED') {
    console.log(`ABORTED: ${abortReason}.`);
    console.log(`Final auth session state: ${sessions.getById(authSessionId)?.state}`);
    logger.warn('manual auth verification aborted', { jobId: job.id, authSessionId, reason: abortReason });
  } else {
    console.log('TIMEOUT: authenticated-dashboard indicators were not detected in time.');
    console.log(`Final auth session state: ${sessions.getById(authSessionId)?.state}`);
    logger.warn('manual auth verification timed out', { jobId: job.id, authSessionId });
  }

  db.close();
  // The live CDP websocket to Chrome keeps the event loop open indefinitely
  // otherwise -- without this, the script hangs after printing its result
  // instead of returning control to the shell.
  process.exit(outcome === 'SUCCESS' ? 0 : 1);
}

main().catch((err) => {
  console.error('Manual verification script failed:', err);
  process.exit(1);
});
