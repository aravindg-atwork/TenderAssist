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
const CDP_PORT = 9222;

async function main(): Promise<void> {
  const portalUrl = process.argv[2];
  if (!portalUrl) {
    console.error('Usage: node dist/scripts/manualAuthVerification.js <PORTAL_LOGIN_URL>');
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
  let authenticated = false;
  while (Date.now() < deadline) {
    authenticated = await flow.checkAuthenticated();
    if (authenticated) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  if (authenticated) {
    jobMachine.transition(job.id, 'AUTHENTICATED', 'auth flow confirmed dashboard indicators');
    console.log('SUCCESS: authenticated-dashboard indicators detected.');
    logger.info('manual auth verification succeeded', { jobId: job.id, authSessionId });
  } else {
    console.log('TIMEOUT: authenticated-dashboard indicators were not detected in time.');
    console.log(`Final auth session state: ${sessions.getById(authSessionId)?.state}`);
    logger.warn('manual auth verification timed out', { jobId: job.id, authSessionId });
  }

  db.close();
}

main().catch((err) => {
  console.error('Manual verification script failed:', err);
  process.exit(1);
});
