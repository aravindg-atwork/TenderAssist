# Live Browser Controller: Chrome Launch + CDP Attach + Auth Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the live browser automation layer — actually launching the user's real Chrome, attaching Playwright over CDP, retaining exactly one `Page`, detecting tab loss (close, CDP target destruction, session-expired navigation) — and an `AuthFlow` orchestrator that wires it to Plan 2's `AuthSessionRepository`/`AuthStateMachine`. This is the plan that turns Plan 2's pure-function/pure-persistence foundation into something that actually drives a browser. It ends with a script the user runs by hand against the real TN Tenders portal with real DSC login — that step cannot be automated or unit-tested.

**Architecture:** `src/browser/chromeLauncher.ts` (extended from Plan 2) gains the actual process-spawning and CDP-readiness-polling functions. A new `BrowserController` class owns the Playwright `Browser`/`Page` handles and all loss-detection wiring, built entirely from mechanisms verified against a real local Chrome instance before this plan was written (see Verified Mechanics below — every non-trivial claim about the Playwright/CDP API in this plan was run against real Chrome first, not guessed). A new `AuthFlow` class is the only thing that touches both the browser layer and the persistence/state layer, keeping `BrowserController` itself persistence-agnostic and reusable later for the acquisition loop.

**Tech Stack:** TypeScript (strict, NodeNext modules), `node:sqlite`, `playwright-core` (new dependency — verified installs with zero native compile step), Vitest. Real Chrome integration tests throughout, guarded with `it.skipIf`/`describe.skipIf` so the suite degrades gracefully (skips, not fails) on a machine without Chrome — consistent with Plan 2's precedent for `chromeLauncher.test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-17-tenderassist-architecture.md`

**Depends on:** `docs/superpowers/plans/2026-09-17-poc-plan1-foundation.md` and `docs/superpowers/plans/2026-09-17-poc-plan2-auth-foundation.md` (both complete). This plan imports `AuthSessionRepository`/`AuthState`, `AuthStateMachine`, `isAuthenticatedDashboard`, `isSessionExpiredPage`, `resolveChromePath`/`buildChromeLaunchArgs`/`ChromeLaunchOptions` from Plan 2, and `JobRepository`/`JobStateMachine`, `StateTransitionRepository`, `createDatabase`/`runMigrations`, `getDatabasePath`/`getAppDataDir` from Plan 1.

## Verified Mechanics (controller-verified against real Chrome before this plan was written — not assumptions)

These were each checked with a live, locally-launched Chrome (`playwright-core@1.63.0`, this machine's installed Chrome, Node 26.3.0) before committing to the code below, because getting the core browser-retention mechanism wrong would be expensive to discover mid-implementation:

- `chromium.connectOverCDP('http://127.0.0.1:<port>')` connects successfully to a Chrome launched with `--remote-debugging-port=<port>`.
- Chrome always opens with exactly one existing page in `browser.contexts()[0].pages()` even with no explicit URL argument (`chrome://new-tab-page/` by default) — so retaining "exactly one Page" means **reusing that existing page**, not always calling `context.newPage()` (which would leave two tabs open).
- A page's CDP `targetId` is obtained via `const pageCdp = await context.newCDPSession(page); const info = await pageCdp.send('Target.getTargetInfo'); info.targetInfo.targetId`.
- A **browser-level** CDP session for observing `Target.targetDestroyed` globally (not tied to one page) is `await browser.newBrowserCDPSession()`, after which `Target.setDiscoverTargets({ discover: true })` must be sent before `'Target.targetDestroyed'` events fire.
- Closing a page fires Playwright's `page.on('close')` **before** the CDP-level `Target.targetDestroyed` event for the same target (verified: 2ms apart, `page.close@...` then `cdp.targetDestroyed@...`) — so a "first loss reason wins" guard reports `TAB_CLOSED`, not `TARGET_DESTROYED`, for a page-initiated close. This ordering held because `page.close()` resolves only after Playwright receives explicit close confirmation, which precedes the browser tearing down the underlying target.
- `page.on('framenavigated', frame => { if (frame === page.mainFrame()) {...} })` fires exactly once per main-frame navigation (verified with two sequential `page.goto()` calls, two events, correct URLs, no spurious non-main-frame noise on a page with no iframes).
- `page.innerText('body')` and `page.url()` both work as expected against a local test HTTP server, including a URL with a query string (`?page=CommonErrorPage&service=direct` round-trips through `page.url()` intact) — confirming Plan 2's `isAuthenticatedDashboard`/`isSessionExpiredPage` can be fed directly from these two calls with no adaptation.
- `GET http://127.0.0.1:<port>/json/version` returns `{ Browser, "Protocol-Version", "User-Agent", "V8-Version", "WebKit-Version", webSocketDebuggerUrl }` once Chrome's CDP endpoint is ready — used as the "is Chrome ready yet" poll target.
- `CDPSession.send()`/`.on()` are fully typed by `playwright-core`'s own `Protocol.CommandParameters`/`Protocol.CommandReturnValues`/`Protocol.Events` maps — the exact `BrowserController` code below type-checks cleanly with zero `any`, verified with a real `tsc --noEmit` run against the actual installed package before this plan was written.

## Global Constraints

- `playwright-core` is the only new npm dependency this plan adds. It installs with zero native compile step (verified: `npm install -D playwright-core` succeeds cleanly on this machine, same as every other dependency in this project). Do not add the full `playwright` package (which bundles browser downloads) — production code always drives the user's real, already-installed Chrome, never a bundled one.
- No `context.newPage()` after the first attach, ever, for the retained page — reuse `context.pages()[0]` when Chrome already has a page open (the normal case), only call `newPage()` if the context genuinely has zero pages.
- Every real-Chrome integration test in this plan is guarded so the suite skips (never fails) on a machine without Chrome installed: `describe.skipIf(!existsSync(CHROME_PATH))(...)` at the suite level, matching Plan 2's `chromeLauncher.test.ts` precedent.
- `node:sqlite` typing pattern from Plan 1/2 still applies wherever this plan touches persistence code: positional `.run()` params, `unknown`-first `.all()` casts.
- Detector precedence (documented in the spec after Plan 2's final review): `AuthFlow.checkAuthenticated()` must only attempt the `AUTHENTICATED` transition when the auth session's current state is `AUTH_PENDING` — if a `SESSION_EXPIRED` navigation event has already fired and moved the session to a terminal state, `checkAuthenticated()` must return `false`, not throw `IllegalAuthTransitionError`. This is how "expiry wins" is actually enforced at the code level, not just documented as a convention.
- Chrome launch must never use `shell: true` (per the spec's Plan 3 launch-hygiene note — `buildChromeLaunchArgs` interpolates a user-derived `userDataDir` into an argv element, which is safe as a plain argument but an injection vector under a shell).
- Real Chrome/TN Tenders portal interaction (Task 4's actual DSC login) is explicitly a manual step performed by the user — do not attempt to fabricate, mock, or assume its outcome. Never guess or hardcode the real TN Tenders portal URL; it is supplied by the user as a runtime argument.

---

### Task 1: `launchChrome` + `waitForCdpReady`

**Files:**
- Modify: `src/browser/chromeLauncher.ts` (adds two functions to the existing file from Plan 2 — do not touch `resolveChromePath`/`buildChromeLaunchArgs`, which stay exactly as they are)
- Modify: `tests/browser/chromeLauncher.test.ts` (adds new test cases to the existing file)

**Interfaces:**
- Consumes: `ChromeLaunchOptions`, `resolveChromePath`, `buildChromeLaunchArgs` from the existing `chromeLauncher.ts` (Plan 2).
- Produces: `interface CdpVersionInfo { Browser: string; webSocketDebuggerUrl: string }`; `function launchChrome(options: ChromeLaunchOptions, chromePath?: string): ChildProcess`; `function waitForCdpReady(port: number, timeoutMs?: number): Promise<CdpVersionInfo>`. Task 2's `BrowserController` tests depend on both of these exactly.

- [ ] **Step 1: Write the failing test**

Add to the bottom of `tests/browser/chromeLauncher.test.ts` (keep all existing `describe` blocks in that file untouched):

```ts
import { afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

describe('launchChrome + waitForCdpReady', () => {
  let tempDirs: string[] = [];
  let procs: Array<{ pid?: number }> = [];

  afterEach(() => {
    for (const proc of procs) {
      if (proc.pid) {
        try {
          process.kill(proc.pid);
        } catch {
          // already exited
        }
      }
    }
    procs = [];
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it.skipIf(!existsSync(CHROME_PATH))(
    'launches Chrome and the CDP endpoint becomes ready',
    async () => {
      const userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-chrome-test-'));
      tempDirs.push(userDataDir);
      const port = 9222 + Math.floor(Math.random() * 5000);

      const proc = launchChrome({ userDataDir, cdpPort: port });
      procs.push(proc);

      const info = await waitForCdpReady(port, 10000);
      expect(info.Browser).toContain('Chrome');
      expect(info.webSocketDebuggerUrl).toContain(`:${port}`);
    },
    15000
  );

  it('waitForCdpReady rejects when nothing is listening on the port', async () => {
    await expect(waitForCdpReady(9, 500)).rejects.toThrow('did not become ready');
  });
});
```

(`existsSync` is already imported at the top of this file from Plan 2's Task 5 — reuse that import, don't add a duplicate.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/browser/chromeLauncher.test.ts`
Expected: FAIL — `launchChrome`/`waitForCdpReady` are not exported from `chromeLauncher.ts` yet.

- [ ] **Step 3: Add the implementation to `src/browser/chromeLauncher.ts`**

Append to the existing file (keep `resolveChromePath`/`buildChromeLaunchArgs`/`DEFAULT_CHROME_PATHS`/`ChromeLaunchOptions` exactly as they are; add these new imports at the top alongside the existing `existsSync` import from `node:fs`, and this new code at the bottom):

```ts
import { spawn, type ChildProcess } from 'node:child_process';

export interface CdpVersionInfo {
  Browser: string;
  webSocketDebuggerUrl: string;
}

export function launchChrome(options: ChromeLaunchOptions, chromePath: string = resolveChromePath()): ChildProcess {
  const args = buildChromeLaunchArgs(options);
  const proc = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  proc.unref();
  return proc;
}

export async function waitForCdpReady(port: number, timeoutMs = 10000): Promise<CdpVersionInfo> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return (await response.json()) as CdpVersionInfo;
      }
    } catch {
      // Chrome isn't accepting connections yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome did not become ready on CDP port ${port} within ${timeoutMs}ms`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/browser/chromeLauncher.test.ts`
Expected: 7 passed (5 existing from Plan 2 + 2 new; the real-Chrome test runs — not skips — on this machine, since Chrome is present at the default path).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: 70/70 passing (68 from Plans 1-2 + 2 new), typecheck clean on both configs.

- [ ] **Step 6: Commit**

```bash
git add src/browser/chromeLauncher.ts tests/browser/chromeLauncher.test.ts
git commit -m "feat: launch real Chrome and poll for CDP readiness"
```

---

### Task 2: `BrowserController`

**Files:**
- Create: `src/browser/browserController.ts`
- Test: `tests/browser/browserController.test.ts`
- Modify: `package.json` (add `playwright-core` as a dependency — this is the first task that needs it)

**Interfaces:**
- Consumes: `launchChrome`/`waitForCdpReady`/`ChromeLaunchOptions` (Task 1), `isSessionExpiredPage` (Plan 2).
- Produces: `type SessionLossReason = 'TAB_CLOSED' | 'TARGET_DESTROYED' | 'SESSION_EXPIRED_PAGE'`; `interface BrowserControllerOptions { cdpEndpoint: string; onSessionLost: (reason: SessionLossReason) => void }`; `class BrowserController { constructor(options: BrowserControllerOptions); attach(): Promise<{ targetId: string }>; getPage(): Page; getTargetId(): string; navigate(url: string): Promise<void>; extractPageText(): Promise<string> }`. Task 3's `AuthFlow` depends on this exact shape, including the exact `SessionLossReason` string values.

- [ ] **Step 1: Add the dependency**

Edit `package.json`, add a `dependencies` block (this project has had none until now):

```json
  "dependencies": {
    "playwright-core": "^1.63.0"
  },
```

Run: `npm install`
Expected: installs cleanly, no native build step (verified before this plan was written).

- [ ] **Step 2: Write the failing test**

```ts
// tests/browser/browserController.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { BrowserController, type SessionLossReason } from '../../src/browser/browserController.js';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

describe.skipIf(!existsSync(CHROME_PATH))('BrowserController', () => {
  let server: Server;
  let serverPort: number;
  let userDataDir: string;
  let chromeProc: ReturnType<typeof launchChrome>;
  let cdpPort: number;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.includes('page=CommonErrorPage')) {
        res.end('<html><body>Your session in the client area has expired.</body></html>');
      } else if (req.url?.includes('/dashboard')) {
        res.end('<html><body>Welcome : test@example.com<br>Bid Management<br>Logout</body></html>');
      } else {
        res.end('<html><body>hello</body></html>');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as { port: number }).port;

    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-bc-test-'));
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

  it('attaches, retains a single page, and returns its CDP targetId', async () => {
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: () => {},
    });

    const { targetId } = await controller.attach();
    expect(typeof targetId).toBe('string');
    expect(targetId.length).toBeGreaterThan(0);
    expect(controller.getTargetId()).toBe(targetId);
  });

  it('navigates and extracts page text', async () => {
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: () => {},
    });
    await controller.attach();

    await controller.navigate(`http://127.0.0.1:${serverPort}/dashboard`);
    const text = await controller.extractPageText();

    expect(text).toContain('Welcome : test@example.com');
    expect(text).toContain('Bid Management');
    expect(text).toContain('Logout');
  });

  it('reports TAB_CLOSED when the retained page is closed', async () => {
    const losses: SessionLossReason[] = [];
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: (reason) => losses.push(reason),
    });
    await controller.attach();

    await controller.getPage().close();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(losses).toContain('TAB_CLOSED');
  });

  it('reports SESSION_EXPIRED_PAGE when navigation lands on a session-expired page', async () => {
    const losses: SessionLossReason[] = [];
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: (reason) => losses.push(reason),
    });
    await controller.attach();

    await controller.navigate(`http://127.0.0.1:${serverPort}/nicgep/app?page=CommonErrorPage`);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(losses).toContain('SESSION_EXPIRED_PAGE');
  });

  it('throws from getPage/getTargetId when not yet attached', () => {
    const controller = new BrowserController({
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      onSessionLost: () => {},
    });
    expect(() => controller.getPage()).toThrow('not attached');
    expect(() => controller.getTargetId()).toThrow('not attached');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/browser/browserController.test.ts`
Expected: FAIL — cannot find module `../../src/browser/browserController.js`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/browser/browserController.ts
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import { isSessionExpiredPage } from './sessionExpiredDetector.js';

export type SessionLossReason = 'TAB_CLOSED' | 'TARGET_DESTROYED' | 'SESSION_EXPIRED_PAGE';

export interface BrowserControllerOptions {
  cdpEndpoint: string;
  onSessionLost: (reason: SessionLossReason) => void;
}

export class BrowserController {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private targetId: string | undefined;
  private lost = false;

  constructor(private options: BrowserControllerOptions) {}

  async attach(): Promise<{ targetId: string }> {
    this.browser = await chromium.connectOverCDP(this.options.cdpEndpoint);
    const context: BrowserContext = this.browser.contexts()[0] ?? (await this.browser.newContext());
    const existingPages = context.pages();
    this.page = existingPages.length > 0 ? existingPages[0] : await context.newPage();

    const pageCdp: CDPSession = await context.newCDPSession(this.page);
    const targetInfo = await pageCdp.send('Target.getTargetInfo');
    this.targetId = targetInfo.targetInfo.targetId;

    this.page.on('close', () => this.reportLoss('TAB_CLOSED'));
    this.page.on('framenavigated', (frame) => {
      if (frame !== this.page!.mainFrame()) return;
      void this.checkSessionExpired();
    });

    const browserCdp = await this.browser.newBrowserCDPSession();
    await browserCdp.send('Target.setDiscoverTargets', { discover: true });
    browserCdp.on('Target.targetDestroyed', (event) => {
      if (event.targetId === this.targetId) {
        this.reportLoss('TARGET_DESTROYED');
      }
    });

    return { targetId: this.targetId };
  }

  private async checkSessionExpired(): Promise<void> {
    if (!this.page || this.lost) return;
    const url = this.page.url();
    let text: string;
    try {
      text = await this.page.innerText('body');
    } catch {
      return;
    }
    if (isSessionExpiredPage(url, text)) {
      this.reportLoss('SESSION_EXPIRED_PAGE');
    }
  }

  private reportLoss(reason: SessionLossReason): void {
    if (this.lost) return;
    this.lost = true;
    this.options.onSessionLost(reason);
  }

  getPage(): Page {
    if (!this.page) throw new Error('BrowserController is not attached');
    return this.page;
  }

  getTargetId(): string {
    if (!this.targetId) throw new Error('BrowserController is not attached');
    return this.targetId;
  }

  async navigate(url: string): Promise<void> {
    await this.getPage().goto(url);
  }

  async extractPageText(): Promise<string> {
    return this.getPage().innerText('body');
  }
}
```

This exact code has already been verified to type-check cleanly against the real `playwright-core` types (`tsc --noEmit`, zero errors) before this plan was written.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/browser/browserController.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: 75/75 passing (70 from Task 1 + 5 new), typecheck clean on both configs.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/browser/browserController.ts tests/browser/browserController.test.ts
git commit -m "feat: BrowserController — CDP attach, single-page retention, tab-loss detection"
```

---

### Task 3: `AuthFlow`

**Files:**
- Create: `src/browser/authFlow.ts`
- Test: `tests/browser/authFlow.test.ts`

**Interfaces:**
- Consumes: `BrowserController`/`SessionLossReason` (Task 2), `launchChrome`/`waitForCdpReady` (Task 1, test setup only), `AuthSessionRepository`/`AuthState` and `AuthStateMachine` (Plan 2), `isAuthenticatedDashboard` (Plan 2).
- Produces: `interface AuthFlowDeps { sessions: AuthSessionRepository; machine: AuthStateMachine }`; `class AuthFlow { constructor(deps: AuthFlowDeps); start(jobId: string, cdpEndpoint: string): Promise<{ authSessionId: string; targetId: string }>; checkAuthenticated(): Promise<boolean>; getPage(): Page }`. This is the module Plan 4 (acquisition loop) will use to drive authentication and then keep using the same retained page for navigation.

**Design note — why `checkAuthenticated()` checks current state before transitioning:** if `BrowserController`'s navigation-triggered `onSessionLost('SESSION_EXPIRED_PAGE')` fires (moving the auth session to the terminal `SESSION_EXPIRED` state) at roughly the same time a caller polls `checkAuthenticated()`, the state machine's `AUTH_PENDING`-only-allows-`AUTHENTICATED` transition table means a naive `checkAuthenticated()` would throw `IllegalAuthTransitionError` instead of gracefully reporting "not authenticated." Guarding on `current.state === 'AUTH_PENDING'` before ever calling `isAuthenticatedDashboard` is what makes "session-expiry wins" (the spec's documented precedence rule) actually true in code, not just true by convention.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/browser/authFlow.test.ts`
Expected: FAIL — cannot find module `../../src/browser/authFlow.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/browser/authFlow.ts
import type { Page } from 'playwright-core';
import type { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import type { AuthStateMachine } from '../state/authStateMachine.js';
import { BrowserController, type SessionLossReason } from './browserController.js';
import { isAuthenticatedDashboard } from './authDetector.js';

export interface AuthFlowDeps {
  sessions: AuthSessionRepository;
  machine: AuthStateMachine;
}

export class AuthFlow {
  private controller: BrowserController | undefined;
  private authSessionId: string | undefined;

  constructor(private deps: AuthFlowDeps) {}

  async start(jobId: string, cdpEndpoint: string): Promise<{ authSessionId: string; targetId: string }> {
    const session = this.deps.sessions.create(jobId);
    this.authSessionId = session.id;

    this.controller = new BrowserController({
      cdpEndpoint,
      onSessionLost: (reason) => this.handleSessionLost(reason),
    });
    const { targetId } = await this.controller.attach();

    this.deps.sessions.setCdpTargetId(session.id, targetId);
    this.deps.machine.transition(session.id, 'AUTH_PENDING', 'browser attached, awaiting human login');

    return { authSessionId: session.id, targetId };
  }

  async checkAuthenticated(): Promise<boolean> {
    if (!this.controller || !this.authSessionId) {
      throw new Error('AuthFlow.start() must be called before checkAuthenticated()');
    }
    const current = this.deps.sessions.getById(this.authSessionId);
    if (!current || current.state !== 'AUTH_PENDING') return false;

    const text = await this.controller.extractPageText();
    if (!isAuthenticatedDashboard(text)) return false;

    this.deps.machine.transition(this.authSessionId, 'AUTHENTICATED', 'dashboard indicators detected');
    return true;
  }

  getPage(): Page {
    if (!this.controller) throw new Error('AuthFlow.start() must be called before getPage()');
    return this.controller.getPage();
  }

  private handleSessionLost(reason: SessionLossReason): void {
    if (!this.authSessionId) return;
    const current = this.deps.sessions.getById(this.authSessionId);
    if (!current) return;
    if (current.state !== 'AUTH_PENDING' && current.state !== 'AUTHENTICATED') return;

    const target = reason === 'SESSION_EXPIRED_PAGE' ? 'SESSION_EXPIRED' : 'TAB_LOST';
    this.deps.machine.transition(this.authSessionId, target, `browser controller reported ${reason}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/browser/authFlow.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: 79/79 passing (75 from Task 2 + 4 new), typecheck clean on both configs.

- [ ] **Step 6: Commit**

```bash
git add src/browser/authFlow.ts tests/browser/authFlow.test.ts
git commit -m "feat: AuthFlow orchestrator wiring BrowserController to the auth state machine"
```

---

### Task 4: Manual verification script + self-directed dry run

**Files:**
- Create: `src/scripts/manualAuthVerification.ts`
- Modify: `package.json` (add a `verify:auth` script)

**Interfaces:**
- Consumes: everything from Tasks 1-3 plus `createDatabase`/`runMigrations` (Plan 1), `JobRepository`/`JobStateMachine` (Plan 1), `getDatabasePath`/`getAppDataDir` (Plan 1), `logger` (Plan 1).
- Produces: a runnable script, not a library module — nothing later depends on its exports.

This task has no TDD cycle in the usual sense — it's an interactive script meant to be run by a human against a real portal, so there's no meaningful unit test for "did the human complete DSC login correctly." Instead: (1) implement the script, (2) do a **self-directed dry run against a local fixture server** (fully automatable, no human needed) to prove the script's wiring is correct end-to-end, (3) leave the **real** acceptance run (against the actual TN Tenders portal with real DSC) as an explicit manual step for the user, described at the end of this task.

- [ ] **Step 1: Write the script**

```ts
// src/scripts/manualAuthVerification.ts
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
```

- [ ] **Step 2: Add the npm script**

Edit `package.json`, add to `scripts`:

```json
    "verify:auth": "node dist/scripts/manualAuthVerification.js"
```

- [ ] **Step 3: Build and run typecheck**

Run: `npm run build && npm run typecheck`
Expected: `dist/scripts/manualAuthVerification.js` exists, typecheck clean on both configs.

- [ ] **Step 4: Self-directed dry run against a local fixture (no human needed)**

Start a throwaway local HTTP server that immediately serves a page carrying all three authenticated-dashboard indicators — this proves the script's wiring (launch → attach → navigate → poll → detect → transition → report) works end-to-end without needing a human to actually log in anywhere:

```bash
node -e "
const http = require('node:http');
const server = http.createServer((req, res) => {
  res.end('<html><body>Welcome : dryrun@example.com<br>Bid Management<br>Logout</body></html>');
});
server.listen(0, () => console.log('fixture server on port', server.address().port));
"
```

In a second terminal, run the script against that fixture URL (substitute the port printed above):

```bash
npm run verify:auth -- http://127.0.0.1:<port>
```

Expected: Chrome launches, navigates to the fixture page (which is already "authenticated"-looking), and within one poll cycle (≤3 seconds) the script prints `SUCCESS: authenticated-dashboard indicators detected.` and exits. Confirm via a direct query that the job/auth-session rows in the local SQLite DB (`%APPDATA%\TenderAssist\tenderassist.db`) ended in `COMPLETE`... no — the script does not transition the job past `AUTHENTICATED` (that's as far as this plan's scope goes), so confirm the job row is in state `AUTHENTICATED` and the auth session row is in state `AUTHENTICATED` with a non-null `authenticated_at`. Kill the fixture server and Chrome process afterward.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/manualAuthVerification.ts package.json
git commit -m "feat: manual auth verification script, dry-run verified against a local fixture"
```

---

## Manual Acceptance (not part of the automated plan — requires the user)

Everything above is machine-verified. What it does **not** verify is the actual, real-world claim this whole plan exists to test: that this mechanism works against the real TN Tenders portal with a real DSC login. That requires:

1. The user has the real TN Tenders portal login URL (this plan deliberately never hardcodes or guesses it).
2. The user has their DSC hardware/software set up on this machine as they normally would for manual TN Tenders use.
3. Run `npm run verify:auth -- <real TN Tenders login URL>`.
4. Complete the normal TN Tenders login + DSC authentication in the Chrome window that opens.
5. Confirm the script reports `SUCCESS` within the 5-minute window, and that this genuinely coincides with reaching the real authenticated dashboard (not a false positive from a page that happens to contain the same three words elsewhere).
6. If it does **not** report success, that is exactly the kind of finding the spec's Unknowns section anticipated (§42/§G: DSC signer behavior over CDP-attached automation is unvalidated) — capture what actually happened (did Chrome open correctly? did DSC signing work at all over this CDP-attached instance? did the dashboard render but the indicators not match?) so the next plan can address it with real evidence instead of guessing.

This step is explicitly out of scope for automated task review — it needs the user to run it and report back what happened.

## Self-Review Notes

- **Spec coverage:** browser strategy steps 1-4 (launch, attach + retain one page + record targetId, auth confirmation via three indicators, loss detection via close/targetDestroyed/session-expired-navigation) are all implemented and verified against real Chrome. Step 5 (no artificial keep-alive) is respected by omission — nothing in this plan adds one. The detector-precedence and Chrome-launch-hygiene notes added to the spec after Plan 2's final review are both honored (`checkAuthenticated`'s state guard; no `shell: true` anywhere `launchChrome` is called).
- **Placeholder scan:** no TBD/TODO markers. Every code block was either verified against real Chrome before being written into this plan, or is a straightforward wiring of already-verified pieces.
- **Type consistency:** `SessionLossReason` defined once in Task 2, consumed by Task 3's `AuthFlow` with the exact same three string values. `AuthFlowDeps` matches exactly what `AuthSessionRepository`/`AuthStateMachine` (Plan 2) already export — no new methods needed on either.
- **Known deferred item carried from Plan 2's spec note:** `AuthSessionRepository.setCdpTargetId()` still has no set-once guard. This plan's `AuthFlow.start()` is now the one real caller — it calls `setCdpTargetId` exactly once, right after `attach()`, and never again for that auth session (a lost session gets a brand-new `AuthSessionRepository.create()` row on retry, per Plan 2's design, not a re-point of the same row). This satisfies the spec's invariant in practice; a hard guard in the repository itself remains optional hardening, not something this plan's usage pattern actually needs.
