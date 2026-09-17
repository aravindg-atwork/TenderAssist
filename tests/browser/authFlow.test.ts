// tests/browser/authFlow.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

describe.skipIf(!existsSync(CHROME_PATH))('AuthFlow', () => {
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

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    sessions = new AuthSessionRepository(db);
    const transitions = new StateTransitionRepository(db);
    machine = new AuthStateMachine(db, sessions, transitions);
    jobId = jobs.create().id;

    server = http.createServer((req, res) => {
      if (req.url?.includes('/dashboard')) {
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
  });

  afterEach(() => {
    if (chromeProc.pid) {
      try {
        process.kill(chromeProc.pid);
      } catch {
        // already exited
      }
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold a transient handle lock on the profile dir for
      // up to ~1s after the Chrome process is killed (verified: kill
      // itself is always clean, no orphaned process, this is filesystem
      // handle-release lag, not a leak) — verified during Task 1's review.
    }
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

  it('transitions to TAB_LOST when the retained tab is closed', async () => {
    const flow = new AuthFlow({ sessions, machine });
    const { authSessionId } = await flow.start(jobId, `http://127.0.0.1:${cdpPort}`);

    await flow.getPage().close();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(sessions.getById(authSessionId)?.state).toBe('TAB_LOST');
  });
});
