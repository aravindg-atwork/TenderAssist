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
import { runAuthJob } from '../orchestration/authJobRunner.js';
import { getDatabasePath, getAppDataDir } from '../config/paths.js';
import { logger } from '../observability/logger.js';

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

  const profileDir = join(getAppDataDir(), 'chrome-profile');
  mkdirSync(profileDir, { recursive: true });

  console.log(`Launching Chrome (profile: ${profileDir})...`);
  launchChrome({ userDataDir: profileDir, cdpPort: CDP_PORT });
  await waitForCdpReady(CDP_PORT, 15000);

  console.log('');
  console.log('Chrome is open. Complete login (and DSC authentication, if applicable) in that window.');
  console.log('Polling for the authenticated-dashboard indicators every 3s, up to 5 minutes.');
  console.log('');

  const final = await runAuthJob(
    { jobs, sessions, jobMachine, authMachine },
    `http://127.0.0.1:${CDP_PORT}`,
    portalUrl,
    () => {
      // Intermediate polling updates stay silent here, matching the
      // script's prior behavior -- only the terminal outcome (below)
      // was ever printed before this refactor.
    }
  );

  console.log('');
  if (final.outcome === 'SUCCESS') {
    console.log('SUCCESS: authenticated-dashboard indicators detected.');
    logger.info('manual auth verification succeeded', { jobId: final.jobId, authSessionId: final.authSessionId });
  } else if (final.outcome === 'ABORTED') {
    console.log(`ABORTED: ${final.abortReason}.`);
    console.log(`Final auth session state: ${final.authState}`);
    logger.warn('manual auth verification aborted', {
      jobId: final.jobId,
      authSessionId: final.authSessionId,
      reason: final.abortReason,
    });
  } else {
    console.log('TIMEOUT: authenticated-dashboard indicators were not detected in time.');
    console.log(`Final auth session state: ${final.authState}`);
    logger.warn('manual auth verification timed out', { jobId: final.jobId, authSessionId: final.authSessionId });
  }

  db.close();
  // The live CDP websocket to Chrome keeps the event loop open indefinitely
  // otherwise -- without this, the script hangs after printing its result
  // instead of returning control to the shell.
  process.exit(final.outcome === 'SUCCESS' ? 0 : 1);
}

main().catch((err) => {
  console.error('Manual verification script failed:', err);
  process.exit(1);
});
