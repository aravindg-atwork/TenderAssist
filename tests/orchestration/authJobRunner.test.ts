// tests/orchestration/authJobRunner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { chromium, type Page } from 'playwright-core';
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

/**
 * Polls (rather than blindly sleeping) until Chrome's default tab has
 * finished its own internal startup navigation (about:blank -> its new-tab
 * page) and settled. waitForCdpReady() only confirms the /json/version HTTP
 * endpoint is up, not that the tab's own navigation has completed -- and
 * this file's tests each attach a SECOND, independent CDP client to that
 * same tab (on top of AuthFlow's own connection), so racing either one
 * against Chrome's still-in-flight internal navigation produced
 * intermittent attach/navigation failures (confirmed via Playwright's
 * pw:api debug tracing) that the plain, single-connection AuthFlow tests in
 * tests/browser/authFlow.test.ts never hit.
 *
 * A first version of this check waited passively for the URL to move off
 * about:blank and then required a cheap `page.evaluate()` to keep succeeding
 * against a stable URL for a short window. That still let a real
 * full-`npm test`-only failure through: `AuthFlow.start()` ->
 * `BrowserController.attach()` throwing `Protocol error
 * (Target.attachToTarget): No target with given id found` from its own
 * `context.newCDPSession(this.page)` call, immediately after this hook had
 * already returned "ready". A second version tightened the stability check
 * to the exact two calls `BrowserController.attach()` itself makes
 * (`context.newCDPSession(page)` + `Target.getTargetInfo`, requiring the
 * SAME targetId across a stability window) -- and *that* still let the
 * identical failure through under heavier full-suite CPU contention: the
 * root cause is that Chrome's default new-tab-page can undergo an internal
 * target swap (a new underlying target/process takes over, while the URL
 * stays the same throughout) more than once, and unpredictably far apart
 * under contention, as it loads its own network-dependent content (most-
 * visited tiles, the "OneGoogleBar", etc.) -- so no fixed-length passive
 * stability window can be trusted to outlast it.
 *
 * This version sidesteps NTP-driven churn outright instead of trying to
 * out-wait it: each attempt connects fresh (a stale Page handle from an
 * earlier attempt is exactly what could be invalidated by the swap this is
 * defending against) and force-navigates the retained tab to `about:blank`
 * -- a fully static, network-free document Chrome has no further reason to
 * swap out from under once loaded. A `context.newCDPSession(page)` +
 * `Target.getTargetInfo` immediately after (the exact calls
 * `BrowserController.attach()` itself makes) confirms that specific
 * codepath genuinely succeeds right now, rather than assuming it does.
 * Any failure (this attempt's connect, the goto, or the CDP probe) just
 * means the tab wasn't ready yet -- retry with a fresh connection rather
 * than reusing a possibly-now-stale one.
 */
const RETRY_POLL_MS = 100;

async function waitForDefaultTabReady(cdpEndpoint: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const probeBrowser = await chromium.connectOverCDP(cdpEndpoint);
      const context = probeBrowser.contexts()[0];
      const page = context?.pages()[0];
      if (!context || !page) {
        throw new Error('freshly-connected browser has no default context/page yet');
      }

      await page.goto('about:blank', { waitUntil: 'load', timeout: 2000 });

      const cdpSession = await context.newCDPSession(page);
      try {
        await cdpSession.send('Target.getTargetInfo');
      } finally {
        await cdpSession.detach().catch(() => {});
      }
      // Deliberately NOT calling probeBrowser.close(): this file's own
      // ABORTED test established that closing a CDP connection's last
      // observed PAGE (not just disconnecting the client) can take the
      // whole Chrome process down with it when it's the sole open tab.
      // This function never closes the page, only navigates it, but a
      // lingering, never-closed client connection is the same safe pattern
      // already used by this file's own browser2 connections elsewhere.
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_POLL_MS));
    }
  }
  throw new Error(
    `Chrome's default tab did not settle within ${timeoutMs}ms (last error: ${lastError instanceof Error ? lastError.message : String(lastError)})`
  );
}

/**
 * Races `promise` against `timeoutMs`, rejecting with a clear, labeled error
 * if it doesn't settle in time. Used below for this file's own "simulate the
 * human" second CDP connection: under this project's full `npm test` run
 * (several real-Chrome test files launching/connecting concurrently), that
 * connection's own establishment or first action can occasionally stall for
 * longer than this test's normal budget -- this turns an otherwise-silent
 * stall (previously surfacing only as this whole test hitting its 60s
 * timeout, with no clue which step was actually stuck) into a fast, specific
 * failure, and callers below retry on it rather than giving up immediately.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not settle within ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Connects a second, independent CDP client to the same running Chrome
 * instance and returns its retained page, retrying on a bounded stall
 * (rather than failing this whole test on one transient hiccup under heavy
 * concurrent load).
 */
async function connectToRetainedPage(cdpEndpoint: string, attempts: number, perAttemptTimeoutMs: number): Promise<Page> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const browser = await withTimeout(chromium.connectOverCDP(cdpEndpoint), perAttemptTimeoutMs, 'connectOverCDP');
      const page = browser.contexts()[0]?.pages()[0];
      if (page) return page;
      lastError = new Error('connectOverCDP succeeded but found no retained page');
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

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
    cdpEndpoint = `http://127.0.0.1:${cdpPort}`;
    // See waitForDefaultTabReady()'s own doc comment above for why this is
    // a poll, not a fixed sleep.
    await waitForDefaultTabReady(cdpEndpoint, 10000);
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
    const page2 = await connectToRetainedPage(cdpEndpoint, 3, 8000);
    await withTimeout(page2.goto(`http://127.0.0.1:${serverPort}/dashboard`), 8000, 'page2.goto(dashboard)');

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
    const page2 = await connectToRetainedPage(cdpEndpoint, 3, 8000);
    await withTimeout(page2.close(), 8000, 'page2.close()');

    const result = await resultPromise;

    expect(result.outcome).toBe('ABORTED');
    expect(result.abortReason).toContain('TAB_LOST');
    expect(result.authState).toBe('TAB_LOST');
    expect(result.jobState).toBe('AUTH_REQUIRED');
  });
});
