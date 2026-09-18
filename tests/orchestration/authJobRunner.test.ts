// tests/orchestration/authJobRunner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../src/persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { JobStateMachine } from '../../src/state/jobStateMachine.js';
import { AuthStateMachine } from '../../src/state/authStateMachine.js';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { runAuthJob, type AuthJobUpdate } from '../../src/orchestration/authJobRunner.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

// A larger per-test timeout than tests/browser/authFlow.test.ts's 30_000:
// this file's tests each open a SECOND, independent CDP connection
// (chromium.connectOverCDP) to the same running Chrome instance, on top of
// runAuthJob's own. That's fine in isolation, but under this project's full
// `npm test` run -- vitest spawns one worker per test file by default, and
// several real-Chrome files (this one, tests/browser/authFlow.test.ts) can
// end up launching/attaching to Chrome at overlapping times -- the extra
// concurrent CDP connection occasionally needs more wall-clock time than
// 30s to settle. runAuthJob's own CDP calls are already bounded internally
// (see src/orchestration/authJobRunner.ts's `bounded()` helper), so this
// headroom is only for this file's own second-connection test code.
describe.skipIf(!CHROME_PATH)('runAuthJob', { timeout: 60_000 }, () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let sessions: AuthSessionRepository;
  let jobMachine: JobStateMachine;
  let authMachine: AuthStateMachine;
  let server: Server;
  let serverPort: number;
  let userDataDir: string;
  let chromeProc: ReturnType<typeof launchChrome>;
  let cdpPort: number;
  let cdpEndpoint: string;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    sessions = new AuthSessionRepository(db);
    const transitions = new StateTransitionRepository(db);
    jobMachine = new JobStateMachine(db, jobs, transitions);
    authMachine = new AuthStateMachine(db, sessions, transitions);

    server = http.createServer((req, res) => {
      if (req.url?.includes('/dashboard')) {
        res.end('<html><body>Welcome : test@example.com<br>Bid Management<br>Logout</body></html>');
      } else {
        res.end('<html><body>please log in</body></html>');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as { port: number }).port;

    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-authjobrunner-test-'));
    cdpPort = 9222 + Math.floor(Math.random() * 5000);
    chromeProc = launchChrome({ userDataDir, cdpPort });
    await waitForCdpReady(cdpPort, 10000);
    // waitForCdpReady() only confirms the /json/version HTTP endpoint is up;
    // it does not confirm Chrome's own default tab has finished its own
    // internal startup navigation (about:blank -> its new-tab page). This
    // file's tests attach a SECOND, independent CDP client (chromium's own
    // connectOverCDP) to that same tab shortly after this hook returns, on
    // top of AuthFlow's own connection -- and empirically, racing either of
    // those against Chrome's still-in-flight internal navigation produced
    // intermittent attach/navigation failures (confirmed via Playwright's
    // pw:api debug tracing) that the plain, single-connection AuthFlow tests
    // in tests/browser/authFlow.test.ts never hit. This short settle window
    // resolved that reliably across repeated runs.
    await new Promise((resolve) => setTimeout(resolve, 500));
    cdpEndpoint = `http://127.0.0.1:${cdpPort}`;
  }, 30_000);

  afterEach(async () => {
    if (chromeProc.pid) {
      try {
        process.kill(chromeProc.pid);
      } catch {
        // already exited
      }
    }
    await removeDirWithRetry(userDataDir);
    server.close();
  });

  it('resolves SUCCESS once the retained tab shows the authenticated dashboard, with no duplicate consecutive auth-state updates', async () => {
    const updates: AuthJobUpdate[] = [];
    const resultPromise = runAuthJob(
      { jobs, sessions, jobMachine, authMachine, pollIntervalMs: 50 },
      cdpEndpoint,
      `http://127.0.0.1:${serverPort}/`,
      (u) => updates.push(u)
    );

    // Give the loop a couple of poll ticks on the "please log in" page, then
    // simulate the human completing login by navigating the SAME retained
    // tab (a second CDP client attached to the same running Chrome, exactly
    // as a human's browser interaction and the poll loop's own connection
    // both observe the one real target) to the dashboard page.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const browser2 = await chromium.connectOverCDP(cdpEndpoint);
    const page2 = browser2.contexts()[0].pages()[0];
    await page2.goto(`http://127.0.0.1:${serverPort}/dashboard`);

    const result = await resultPromise;

    expect(result.outcome).toBe('SUCCESS');
    expect(result.jobState).toBe('AUTHENTICATED');
    expect(result.authState).toBe('AUTHENTICATED');

    const authStates = updates.map((u) => u.authState);
    for (let i = 1; i < authStates.length; i += 1) {
      expect(authStates[i]).not.toBe(authStates[i - 1]);
    }
    expect(updates.at(-1)?.outcome).toBe('SUCCESS');
  });

  it('resolves TIMEOUT when authentication is never detected, leaving job/auth state at AUTH_PENDING', async () => {
    const result = await runAuthJob(
      { jobs, sessions, jobMachine, authMachine, pollIntervalMs: 30, timeoutMs: 150 },
      cdpEndpoint,
      `http://127.0.0.1:${serverPort}/`,
      () => {}
    );

    expect(result.outcome).toBe('TIMEOUT');
    expect(result.jobState).toBe('AUTH_PENDING');
    expect(result.authState).toBe('AUTH_PENDING');
  });

  it('resolves ABORTED and moves the job back to AUTH_REQUIRED when the retained tab is closed', async () => {
    const resultPromise = runAuthJob(
      { jobs, sessions, jobMachine, authMachine, pollIntervalMs: 50 },
      cdpEndpoint,
      `http://127.0.0.1:${serverPort}/`,
      () => {}
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    const browser2 = await chromium.connectOverCDP(cdpEndpoint);
    const page2 = browser2.contexts()[0].pages()[0];
    await page2.close();

    const result = await resultPromise;

    expect(result.outcome).toBe('ABORTED');
    expect(result.abortReason).toContain('TAB_LOST');
    expect(result.authState).toBe('TAB_LOST');
    expect(result.jobState).toBe('AUTH_REQUIRED');
  });
});
