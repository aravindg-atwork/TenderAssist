// tests/browser/authFlow.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../src/persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { AuthStateMachine } from '../../src/state/authStateMachine.js';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { AuthFlow } from '../../src/browser/authFlow.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!CHROME_PATH)('AuthFlow', { timeout: 30_000 }, () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let sessions: AuthSessionRepository;
  let machine: AuthStateMachine;
  let jobId: string;
  let server: Server;
  let serverPort: number;
  let userDataDir: string;
  let chromeProc: ReturnType<typeof launchChrome>;
  let cdpPort: number;
  let dscClicks = 0;

  beforeEach(async () => {
    dscClicks = 0;
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    sessions = new AuthSessionRepository(db);
    const transitions = new StateTransitionRepository(db);
    machine = new AuthStateMachine(db, sessions, transitions);
    jobId = jobs.create().id;

    server = http.createServer((req, res) => {
      if (req.url?.includes('/both-expired-and-dashboard')) {
        res.end(
          '<html><body>Welcome : test@example.com<br>Bid Management<br>Logout<br>Your session in the client area has expired.</body></html>'
        );
      } else if (req.url?.includes('/dsc-page')) {
        res.end('<html><body>Digital Certificate Authentication <a href="/dsc-click">DSC Login</a></body></html>');
      } else if (req.url?.includes('/dsc-click')) {
        dscClicks += 1;
        res.end('<html><body>Authenticating... Please wait</body></html>');
      } else if (req.url?.includes('/dashboard')) {
        res.end('<html><body>Welcome : test@example.com<br>Bid Management<br>Logout</body></html>');
      } else {
        res.end('<html><body>please log in</body></html>');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as { port: number }).port;

    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-authflow-test-'));
    cdpPort = 9222 + Math.floor(Math.random() * 5000);
    chromeProc = launchChrome({ userDataDir, cdpPort });
    await waitForCdpReady(cdpPort, 10000);
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

  it('start() creates an auth session, attaches, and transitions to AUTH_PENDING', async () => {
    const flow = new AuthFlow({ sessions, machine });
    const { authSessionId, targetId } = await flow.start(jobId, `http://127.0.0.1:${cdpPort}`);

    const session = sessions.getById(authSessionId)!;
    expect(session.state).toBe('AUTH_PENDING');
    expect(session.cdp_target_id).toBe(targetId);
  });

  it('checkAuthenticated transitions to AUTHENTICATED once the dashboard indicators appear', async () => {
    const flow = new AuthFlow({ sessions, machine });
    const { authSessionId } = await flow.start(jobId, `http://127.0.0.1:${cdpPort}`);

    expect(await flow.checkAuthenticated()).toBe(false);
    expect(sessions.getById(authSessionId)?.state).toBe('AUTH_PENDING');

    // Simulate the human completing login by navigating the retained tab
    // to a page carrying the three authenticated-dashboard indicators.
    await flow.getPage().goto(`http://127.0.0.1:${serverPort}/dashboard`);

    expect(await flow.checkAuthenticated()).toBe(true);
    expect(sessions.getById(authSessionId)?.state).toBe('AUTHENTICATED');
  });

  it('checkAuthenticated returns false without throwing once the session has already expired', async () => {
    const flow = new AuthFlow({ sessions, machine });
    const { authSessionId } = await flow.start(jobId, `http://127.0.0.1:${cdpPort}`);

    machine.transition(authSessionId, 'SESSION_EXPIRED', 'test-forced expiry');

    await expect(flow.checkAuthenticated()).resolves.toBe(false);
    expect(sessions.getById(authSessionId)?.state).toBe('SESSION_EXPIRED');
  });

  it('checkAuthenticated treats expiry as taking precedence when a page shows both indicators', async () => {
    const flow = new AuthFlow({ sessions, machine });
    const { authSessionId } = await flow.start(jobId, `http://127.0.0.1:${cdpPort}`);

    // A page that satisfies BOTH the authenticated-dashboard detector and the
    // session-expired detector at once (the spec's documented TN Tenders
    // scenario: an expiry banner rendered inside chrome that still shows
    // Welcome/Logout/Bid Management).
    await flow.getPage().goto(`http://127.0.0.1:${serverPort}/both-expired-and-dashboard`);

    // Navigating to this page also triggers BrowserController's own
    // framenavigated-driven expiry check, which independently races
    // checkAuthenticated() and in practice wins, moving the session straight
    // to SESSION_EXPIRED before this call runs. We deliberately assert the
    // safety guarantee (never falsely AUTHENTICATED) rather than the exact
    // intermediate state, since in real polling usage (not immediately after
    // a navigation) checkAuthenticated()'s own isSessionExpiredPage check is
    // what actually catches this — this test can't cleanly isolate that race
    // without mocking, which this project avoids.
    expect(await flow.checkAuthenticated()).toBe(false);
    expect(sessions.getById(authSessionId)?.state).not.toBe('AUTHENTICATED');
  });

  it('transitions to TAB_LOST when the retained tab is closed', async () => {
    const flow = new AuthFlow({ sessions, machine });
    const { authSessionId } = await flow.start(jobId, `http://127.0.0.1:${cdpPort}`);

    await flow.getPage().close();
    await waitFor(() => sessions.getById(authSessionId)?.state === 'TAB_LOST');

    expect(sessions.getById(authSessionId)?.state).toBe('TAB_LOST');
  });

  it('invokes onAuthSessionLost with the reason and terminal state when the tab is closed', async () => {
    const calls: Array<{ reason: string; terminalState: string }> = [];
    const flow = new AuthFlow({
      sessions,
      machine,
      onAuthSessionLost: (reason, terminalState) => {
        calls.push({ reason, terminalState });
      },
    });
    const { authSessionId } = await flow.start(jobId, `http://127.0.0.1:${cdpPort}`);

    await flow.getPage().close();
    await waitFor(() => sessions.getById(authSessionId)?.state === 'TAB_LOST');

    expect(calls).toEqual([{ reason: 'TAB_CLOSED', terminalState: 'TAB_LOST' }]);
  });

  it('stop() prevents a deliberate post-SUCCESS tab close from downgrading an already-AUTHENTICATED session', async () => {
    // Reproduces the real bug: a caller (runAuthJob) closes Chrome right
    // after reaching a terminal outcome, to free the profile lock for the
    // next job. Without stop(), that close was reported as TAB_CLOSED and
    // silently overwrote the just-recorded AUTHENTICATED state.
    const calls: Array<{ reason: string; terminalState: string }> = [];
    const flow = new AuthFlow({
      sessions,
      machine,
      onAuthSessionLost: (reason, terminalState) => {
        calls.push({ reason, terminalState });
      },
    });
    const { authSessionId } = await flow.start(jobId, `http://127.0.0.1:${cdpPort}`);
    await flow.getPage().goto(`http://127.0.0.1:${serverPort}/dashboard`);
    expect(await flow.checkAuthenticated()).toBe(true);

    flow.stop();
    await flow.getPage().close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(sessions.getById(authSessionId)?.state).toBe('AUTHENTICATED');
    expect(calls).toEqual([]);
  });

  it('never clicks DSC Login a second time while a slow first click is still pausing', async () => {
    // A pause longer than the caller waits, like automation pacing at 2-5 s.
    const flow = new AuthFlow({ sessions, machine, paceAction: () => new Promise((resolve) => setTimeout(resolve, 1_500)) });
    await flow.start(jobId, `http://127.0.0.1:${cdpPort}`);
    await flow.getPage().goto(`http://127.0.0.1:${serverPort}/dsc-page`);

    const first = flow.startDscLoginIfAvailable();
    const second = await flow.startDscLoginIfAvailable();
    expect(second).toBe(false);
    expect(await first).toBe(true);
    expect(await flow.startDscLoginIfAvailable()).toBe(false);
    expect(dscClicks).toBe(1);

    // Asking for a fresh signer allows exactly one more click.
    await flow.getPage().goto(`http://127.0.0.1:${serverPort}/dsc-page`);
    flow.allowDscLoginAgain();
    expect(await flow.startDscLoginIfAvailable()).toBe(true);
    expect(dscClicks).toBe(2);
  });

  it('opening the login form never clicks DSC Login, and parallel attempts share one', async () => {
    const flow = new AuthFlow({ sessions, machine });
    await flow.start(jobId, `http://127.0.0.1:${cdpPort}`);
    await flow.getPage().goto(`http://127.0.0.1:${serverPort}/dsc-page`);

    const [first, second] = await Promise.all([
      flow.prepareLogin({ loginId: 'operator', password: 'secret' }),
      flow.prepareLogin({ loginId: 'operator', password: 'secret' }),
    ]);

    expect(first).toBe('LOGIN_FORM_NOT_FOUND');
    expect(second).toBe('LOGIN_FORM_NOT_FOUND');
    expect(dscClicks).toBe(0);
  });
});
