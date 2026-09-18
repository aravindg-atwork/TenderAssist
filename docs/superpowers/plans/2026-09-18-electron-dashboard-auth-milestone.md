# Electron Dashboard — Auth-Flow Milestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build TenderAssist's first UI — an Electron desktop app that makes the existing end-to-end auth flow (create job → launch real Chrome → human logs in → job reaches `AUTHENTICATED`) visible and clickable, with two screens (job list, job detail) and no placeholder screens for work that doesn't exist yet (search execution, classification, documents — Plan 6+).

**Architecture:** The Electron main process is a direct, in-process consumer of the existing backend (`JobRepository`, `AuthSessionRepository`, `StateTransitionRepository`, `JobStateMachine`, `AuthStateMachine`, `AuthFlow`, `chromeLauncher`) — no server, no HTTP layer. A new shared orchestration function, `runAuthJob` (`src/orchestration/authJobRunner.ts`), extracts the job-creation/Chrome-attach/poll-until-terminal sequence currently inlined in `src/scripts/manualAuthVerification.ts`, so both the CLI script and the Electron app call the identical, unit-tested logic. The renderer is a React+TypeScript single-page app (Vite-bundled, built to static files, loaded via `BrowserWindow.loadFile`) that talks to the main process only through a narrow `contextBridge`-exposed `window.tenderAssist` API.

**Tech Stack:** TypeScript (strict), Electron, React 18+, Vite (already a devDependency via vitest), `node:sqlite`, Vitest. New dependencies: `electron`, `react`, `react-dom`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom` (exact versions: let `npm install` resolve latest compatible — do not hand-pick version numbers).

**Spec:** `docs/superpowers/specs/2026-09-18-electron-dashboard-design.md` (this plan's design). Also references `docs/superpowers/specs/2026-09-17-tenderassist-architecture.md` (the underlying backend architecture this UI sits on top of).

**Depends on:** Plans 1-5 (all complete). Imports `JobRepository`/`JobState` (`src/persistence/repositories/jobRepository.ts`), `AuthSessionRepository`/`AuthState` (`src/persistence/repositories/authSessionRepository.ts`), `StateTransitionRepository`/`StateTransitionRow` (`src/persistence/repositories/stateTransitionRepository.ts`), `JobStateMachine` (`src/state/jobStateMachine.ts`), `AuthStateMachine` (`src/state/authStateMachine.ts`), `AuthFlow` (`src/browser/authFlow.ts`), `reactToAuthSessionLoss` (`src/browser/authJobCoordinator.ts`), `launchChrome`/`waitForCdpReady` (`src/browser/chromeLauncher.ts`), `createDatabase`/`runMigrations` (`src/persistence/db.ts`, `src/persistence/migrate.ts`), `getDatabasePath`/`getAppDataDir` (`src/config/paths.ts`). Modifies `src/scripts/manualAuthVerification.ts`.

## Global Constraints

- The Electron main process is a direct, in-process consumer of the existing backend modules — no new server, no HTTP API layer, no duplicated SQL. This is the design's core architectural decision.
- Only one job may be actively running through the UI at a time (single-active-job constraint from the design spec) — the main process tracks this and rejects a second `startJob()` call while one is in flight.
- `node:sqlite` typing conventions from Plans 1-5 apply to any touched repository file: positional `.run()` params, `unknown`-first `.all()` casts.
- TypeScript strict mode; no `any` — in both `src/` (NodeNext modules, `.js`-suffixed relative imports required) and `renderer/` (Bundler module resolution, no `.js` suffix on imports — these are two genuinely different resolution modes; do not mix the import styles across the boundary).
- The portal URL is hardcoded to `https://tntenders.gov.in/nicgep/app` (Plan 5's verified real portal base URL) inside the Electron app. The CLI script (`manualAuthVerification.ts`) keeps taking it as a `process.argv[2]` argument — unchanged, existing behavior.
- No packaging/installer (electron-builder/forge) in this plan — `npm run electron` (build + launch) is sufficient.
- No automated test suite for the Electron shell or React renderer in this plan — verification is manual (documented step-by-step in Task 7). `src/orchestration/authJobRunner.ts` is the one new piece of logic that DOES get full automated TDD coverage, following the exact pattern already established by `tests/browser/authFlow.test.ts`: real in-memory SQLite via `runMigrations`, a real Chrome instance guarded by `describe.skipIf(!CHROME_PATH)`, and the shared `tests/support/chrome.ts` (`CHROME_PATH`) / `tests/support/removeDirWithRetry.ts` helpers.

---

### Task 1: `JobRepository.listAll()`

**Files:**
- Modify: `src/persistence/repositories/jobRepository.ts`
- Modify: `tests/persistence/repositories/jobRepository.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `JobRepository.listAll(): JobRow[]` (ordered `created_at DESC, rowid DESC` — newest first, matching `findIncomplete`'s existing ordering convention). Task 4's `list-jobs` IPC handler calls this directly.

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe('JobRepository', ...)` block in `tests/persistence/repositories/jobRepository.test.ts` (alongside the existing tests — do not modify any of them):

```ts
  it('listAll returns every job, newest first', async () => {
    const first = repo.create();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = repo.create();

    const all = repo.listAll();
    expect(all.map((j) => j.id)).toEqual([second.id, first.id]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/persistence/repositories/jobRepository.test.ts`
Expected: FAIL — `repo.listAll is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/persistence/repositories/jobRepository.ts`, add this method to the `JobRepository` class, immediately after `getById` (before `updateState`):

```ts
  listAll(): JobRow[] {
    return this.db
      .prepare('SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC')
      .all() as unknown as JobRow[];
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/persistence/repositories/jobRepository.test.ts`
Expected: 6 passed (5 existing + 1 new).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: 125/125 passing (124 existing + 1 new), typecheck clean on both configs.

- [ ] **Step 6: Commit**

```bash
git add src/persistence/repositories/jobRepository.ts tests/persistence/repositories/jobRepository.test.ts
git commit -m "feat: JobRepository.listAll() for the dashboard's job list screen"
```

---

### Task 2: Extract `runAuthJob` orchestration function; rewire the CLI script onto it

**Files:**
- Create: `src/orchestration/authJobRunner.ts`
- Test: `tests/orchestration/authJobRunner.test.ts`
- Modify: `src/scripts/manualAuthVerification.ts`

**Interfaces:**
- Consumes: `JobRepository`/`JobState` (`src/persistence/repositories/jobRepository.ts`), `AuthSessionRepository`/`AuthState` (`src/persistence/repositories/authSessionRepository.ts`), `JobStateMachine` (`src/state/jobStateMachine.ts`), `AuthStateMachine` (`src/state/authStateMachine.ts`), `AuthFlow` (`src/browser/authFlow.ts`), `reactToAuthSessionLoss` (`src/browser/authJobCoordinator.ts`).
- Produces: `interface AuthJobUpdate { jobId: string; authSessionId: string; jobState: JobState; authState: AuthState; outcome?: 'SUCCESS' | 'TIMEOUT' | 'ABORTED'; abortReason?: string }`; `interface AuthJobRunnerDeps { jobs: JobRepository; sessions: AuthSessionRepository; jobMachine: JobStateMachine; authMachine: AuthStateMachine; pollIntervalMs?: number; timeoutMs?: number }`; `function runAuthJob(deps: AuthJobRunnerDeps, cdpEndpoint: string, portalUrl: string, onUpdate: (update: AuthJobUpdate) => void): Promise<AuthJobUpdate>`. Task 4's `ipcTypes.ts` re-exports `AuthJobUpdate`; Task 6's `start-job` IPC handler calls `runAuthJob` directly.

`runAuthJob` takes an already-running Chrome's CDP endpoint (a plain string) rather than launching Chrome itself — Chrome-launching (`launchChrome`/`waitForCdpReady`, profile-dir/port selection) stays as a small, separately-owned step in each of its two callers (the CLI script here in this task; the Electron `start-job` handler in Task 6), exactly as it already is in the pre-refactor `manualAuthVerification.ts`. This keeps `runAuthJob` testable with the exact same real-Chrome-plus-fixture-server technique `tests/browser/authFlow.test.ts` already uses, without needing to manage a spawned Chrome process from inside the function under test.

`onUpdate` fires once right after the auth session reaches `AUTH_PENDING` (so callers learn `jobId`/`authSessionId` immediately), again each time the polling loop observes the auth session's state actually change (not on every poll tick), and once more with the final `AuthJobUpdate` carrying `outcome` (and `abortReason` if applicable) when the loop ends.

- [ ] **Step 1: Write the failing tests**

```ts
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

describe.skipIf(!CHROME_PATH)('runAuthJob', { timeout: 30_000 }, () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/orchestration/authJobRunner.test.ts`
Expected: FAIL — cannot find module `../../src/orchestration/authJobRunner.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/orchestration/authJobRunner.ts
import type { JobRepository, JobState } from '../persistence/repositories/jobRepository.js';
import type { AuthSessionRepository, AuthState } from '../persistence/repositories/authSessionRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';
import type { AuthStateMachine } from '../state/authStateMachine.js';
import { AuthFlow } from '../browser/authFlow.js';
import { reactToAuthSessionLoss } from '../browser/authJobCoordinator.js';

export interface AuthJobRunnerDeps {
  jobs: JobRepository;
  sessions: AuthSessionRepository;
  jobMachine: JobStateMachine;
  authMachine: AuthStateMachine;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface AuthJobUpdate {
  jobId: string;
  authSessionId: string;
  jobState: JobState;
  authState: AuthState;
  outcome?: 'SUCCESS' | 'TIMEOUT' | 'ABORTED';
  abortReason?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function runAuthJob(
  deps: AuthJobRunnerDeps,
  cdpEndpoint: string,
  portalUrl: string,
  onUpdate: (update: AuthJobUpdate) => void
): Promise<AuthJobUpdate> {
  const { jobs, sessions, jobMachine, authMachine } = deps;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const job = jobs.create();
  jobMachine.transition(job.id, 'AUTH_REQUIRED', 'UI-initiated auth job');

  const flow = new AuthFlow({
    sessions,
    machine: authMachine,
    onAuthSessionLost: reactToAuthSessionLoss(jobMachine, job.id),
  });
  const { authSessionId } = await flow.start(job.id, cdpEndpoint);
  jobMachine.transition(job.id, 'AUTH_PENDING', 'browser attached');
  await flow.getPage().goto(portalUrl);

  const snapshot = (): AuthJobUpdate => ({
    jobId: job.id,
    authSessionId,
    jobState: jobs.getById(job.id)!.state,
    authState: sessions.getById(authSessionId)!.state,
  });

  let lastAuthState: AuthState = sessions.getById(authSessionId)!.state;
  onUpdate(snapshot());

  const deadline = Date.now() + timeoutMs;
  let outcome: 'SUCCESS' | 'TIMEOUT' | 'ABORTED' = 'TIMEOUT';
  let abortReason: string | undefined;

  while (Date.now() < deadline) {
    let authenticated: boolean;
    try {
      authenticated = await flow.checkAuthenticated();
    } catch (err) {
      outcome = 'ABORTED';
      abortReason = `checkAuthenticated() failed: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }

    if (authenticated) {
      outcome = 'SUCCESS';
      break;
    }

    const state = sessions.getById(authSessionId)!.state;
    if (state !== lastAuthState) {
      lastAuthState = state;
      onUpdate(snapshot());
    }

    if (state === 'TAB_LOST' || state === 'SESSION_EXPIRED') {
      outcome = 'ABORTED';
      abortReason = `auth session reached terminal state ${state} before authentication was detected`;
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (outcome === 'SUCCESS') {
    jobMachine.transition(job.id, 'AUTHENTICATED', 'auth flow confirmed dashboard indicators');
  }

  const final: AuthJobUpdate = { ...snapshot(), outcome, abortReason };
  onUpdate(final);
  return final;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/orchestration/authJobRunner.test.ts`
Expected: 3 passed. (If running on a machine without Chrome installed, all 3 are skipped instead — that's expected per `describe.skipIf(!CHROME_PATH)`, matching every other real-Chrome suite in this repo.)

- [ ] **Step 5: Rewrite `manualAuthVerification.ts` to call `runAuthJob`**

Replace the entire contents of `src/scripts/manualAuthVerification.ts` with:

```ts
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
```

This preserves the script's exact prior external behavior (same console output, same exit codes) — it's now a thin caller of `runAuthJob` instead of inlining the logic itself.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run build && npm run typecheck`
Expected: 128/128 passing (125 from Task 1 + 3 new from this task), build clean, typecheck clean on both configs.

- [ ] **Step 7: Commit**

```bash
git add src/orchestration/authJobRunner.ts tests/orchestration/authJobRunner.test.ts src/scripts/manualAuthVerification.ts
git commit -m "refactor: extract runAuthJob orchestration function, shared by the CLI script and (soon) the Electron app"
```

---

### Task 3: Electron + Vite/React scaffolding (walking skeleton)

**Files:**
- Create: `src/electron/main.ts`
- Create: `src/electron/preload.cts`
- Create: `renderer/index.html`
- Create: `renderer/vite.config.ts`
- Create: `renderer/tsconfig.json`
- Create: `renderer/src/main.tsx`
- Create: `renderer/src/App.tsx`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing yet (no IPC in this task — that's Task 4+).
- Produces: a working `npm run electron` command that opens an Electron window showing a React-rendered "TenderAssist" heading. Later tasks build on this shell.

This task has no automated tests (Electron/renderer shell code, per this plan's Global Constraints) — verification is the manual step below.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev electron vite @vitejs/plugin-react @types/react @types/react-dom
npm install react react-dom
```

Let npm resolve the latest compatible versions — do not hand-pick version numbers in `package.json`.

- [ ] **Step 2: Write `src/electron/preload.cts`**

The `.cts` extension is deliberate: TypeScript always compiles a `.cts` file to CommonJS (`.cjs` output) regardless of the project's `"module": "NodeNext"` setting, which is what an Electron preload script needs — CommonJS preload scripts work correctly across every Electron version's sandboxing model, unlike ESM preload support, which is newer and version-dependent. The main process itself (`main.ts`, below) has no such constraint and stays a normal ESM `.ts` file like the rest of `src/`.

```ts
// src/electron/preload.cts
// Intentionally minimal for now -- the real contextBridge API surface is
// added in Task 4, once there's an IPC contract to expose.
export {};
```

- [ ] **Step 3: Write `src/electron/main.ts`**

```ts
// src/electron/main.ts
import { app, BrowserWindow } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void win.loadFile(join(__dirname, '..', '..', 'renderer', 'dist', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 4: Write the renderer**

```html
<!-- renderer/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>TenderAssist</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```ts
// renderer/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  // Relative asset paths -- required for the built index.html to load
  // correctly under Electron's file:// protocol via loadFile(). Without
  // this, Vite emits absolute "/assets/..." paths that resolve against the
  // filesystem root instead of the app's own directory, and the window
  // loads blank.
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

```json
// renderer/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

This is a standalone config, not extending the root `tsconfig.json` — the renderer runs in a browser context (needs the `DOM` lib and JSX) and is bundled by Vite/esbuild directly (this file is for type-checking and editor support, following the same "sibling config for a different execution context" pattern as `tsconfig.test.json`). Its `Bundler` module resolution means relative imports are written *without* a `.js` suffix here — the opposite of the NodeNext convention used everywhere under `src/`. Keep the two straight: `src/**/*.ts` imports end in `.js`; `renderer/**/*.tsx` imports do not.

```tsx
// renderer/src/App.tsx
export function App() {
  return <h1>TenderAssist</h1>;
}
```

```tsx
// renderer/src/main.tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');
createRoot(container).render(<App />);
```

- [ ] **Step 5: Wire `package.json`**

Add a `"main"` field (Electron's entry point) and two scripts:

```json
{
  "main": "dist/electron/main.js",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.test.json && tsc --noEmit -p renderer/tsconfig.json",
    "verify:auth": "node dist/scripts/manualAuthVerification.js",
    "renderer:build": "vite build --config renderer/vite.config.ts",
    "electron": "npm run build && npm run renderer:build && electron ."
  }
}
```

(This replaces the existing `"typecheck"` line to add the renderer's own type-check, and adds the two new script entries plus the top-level `"main"` field — every other existing field and script stays as-is.)

- [ ] **Step 6: Update `.gitignore`**

Add one line so the renderer's build output isn't committed (the existing bare `dist/` entry only covers the root `tsc` output, not `renderer/dist/`):

```
renderer/dist/
```

- [ ] **Step 7: Verify the walking skeleton manually**

Run: `npm run electron`
Expected: an Electron window opens (roughly 1000x700) showing the text "TenderAssist" as a heading, no console errors about a missing preload script or a blank white window. Close the window to exit.

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: clean on all three configs (root, test, renderer).

- [ ] **Step 9: Commit**

```bash
git add src/electron/main.ts src/electron/preload.cts renderer/index.html renderer/vite.config.ts renderer/tsconfig.json renderer/src/main.tsx renderer/src/App.tsx package.json package-lock.json .gitignore
git commit -m "feat: Electron + Vite/React scaffolding, walking-skeleton window"
```

---

### Task 4: Shared IPC types, `list-jobs`, and the Job List screen

**Files:**
- Create: `src/electron/ipcTypes.ts`
- Modify: `src/electron/main.ts`
- Modify: `src/electron/preload.cts`
- Create: `renderer/src/global.d.ts`
- Create: `renderer/src/components/JobList.tsx`
- Modify: `renderer/src/App.tsx`

**Interfaces:**
- Consumes: `JobRepository`/`JobState` (`src/persistence/repositories/jobRepository.ts`), `AuthSessionRepository`/`AuthState` (`src/persistence/repositories/authSessionRepository.ts`), `AuthJobUpdate` (Task 2, `src/orchestration/authJobRunner.ts`).
- Produces: `interface JobListItem { jobId: string; jobState: JobState; authState: AuthState | null; createdAt: string; updatedAt: string }`; `interface TenderAssistApi { listJobs(): Promise<JobListItem[]>; startJob(): Promise<{ jobId: string }>; getJobDetail(jobId: string): Promise<JobDetail>; onJobUpdate(callback: (update: AuthJobUpdate) => void): () => void }` (the full API surface, defined now even though `startJob`/`getJobDetail` aren't implemented in `main.ts` until Tasks 5-6 — this is the one contract file both the main process and the renderer import types from, so it's defined completely up front). Task 5 adds `JobDetail`'s definition and implements `get-job-detail`; Task 6 implements `start-job` and the `job-updated` push.

No automated tests for this task (Electron/renderer shell code) — verification is manual (Step 6 below).

- [ ] **Step 1: Write `src/electron/ipcTypes.ts`**

```ts
// src/electron/ipcTypes.ts
import type { JobState } from '../persistence/repositories/jobRepository.js';
import type { AuthState } from '../persistence/repositories/authSessionRepository.js';
import type { StateTransitionRow } from '../persistence/repositories/stateTransitionRepository.js';
import type { AuthJobUpdate } from '../orchestration/authJobRunner.js';

export interface JobListItem {
  jobId: string;
  jobState: JobState;
  authState: AuthState | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobDetail {
  jobId: string;
  jobState: JobState;
  authSessionId: string | null;
  authState: AuthState | null;
  jobTransitions: StateTransitionRow[];
  authTransitions: StateTransitionRow[];
}

export type { AuthJobUpdate };

export interface TenderAssistApi {
  listJobs(): Promise<JobListItem[]>;
  startJob(): Promise<{ jobId: string }>;
  getJobDetail(jobId: string): Promise<JobDetail>;
  onJobUpdate(callback: (update: AuthJobUpdate) => void): () => void;
}
```

This file contains only type-level imports/exports (`import type`, `export type`) — it compiles to an empty JS file, and is safe to import from the renderer (a different execution context) as a type-only reference with no runtime Node code crossing the boundary.

- [ ] **Step 2: Implement `list-jobs` and expose the real API in `main.ts`**

Replace `src/electron/main.ts`'s contents with:

```ts
// src/electron/main.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../persistence/db.js';
import { runMigrations } from '../persistence/migrate.js';
import { JobRepository } from '../persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../persistence/repositories/stateTransitionRepository.js';
import { JobStateMachine } from '../state/jobStateMachine.js';
import { AuthStateMachine } from '../state/authStateMachine.js';
import { getDatabasePath } from '../config/paths.js';
import type { JobListItem } from './ipcTypes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = createDatabase(getDatabasePath());
runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
const jobs = new JobRepository(db);
const sessions = new AuthSessionRepository(db);
const transitions = new StateTransitionRepository(db);
const jobMachine = new JobStateMachine(db, jobs, transitions);
const authMachine = new AuthStateMachine(db, sessions, transitions);

let mainWindow: BrowserWindow | undefined;

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

(`jobMachine`/`authMachine` are unused by this task's single handler but are constructed here now since Tasks 5-6 need them in this same module-level scope — keeping all backend wiring in one place rather than re-deriving it per task.)

- [ ] **Step 3: Expose the real `contextBridge` API in `preload.cts`**

Replace `src/electron/preload.cts`'s contents with:

```ts
// src/electron/preload.cts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TenderAssistApi, AuthJobUpdate } from './ipcTypes.js';

const api: TenderAssistApi = {
  listJobs: () => ipcRenderer.invoke('list-jobs'),
  startJob: () => ipcRenderer.invoke('start-job'),
  getJobDetail: (jobId) => ipcRenderer.invoke('get-job-detail', jobId),
  onJobUpdate: (callback) => {
    const listener = (_event: IpcRendererEvent, update: AuthJobUpdate) => callback(update);
    ipcRenderer.on('job-updated', listener);
    return () => ipcRenderer.removeListener('job-updated', listener);
  },
};

contextBridge.exposeInMainWorld('tenderAssist', api);
```

Calling `startJob()` or `getJobDetail()` from the renderer at this point in the plan will reject (no handler registered yet for `'start-job'`/`'get-job-detail'`) — expected until Tasks 5-6 implement them. `onJobUpdate` and `listJobs` work fully as of this task.

- [ ] **Step 4: Declare the global `window.tenderAssist` type for the renderer**

```ts
// renderer/src/global.d.ts
import type { TenderAssistApi } from '../../src/electron/ipcTypes';

declare global {
  interface Window {
    tenderAssist: TenderAssistApi;
  }
}

export {};
```

- [ ] **Step 5: Write the Job List screen**

```tsx
// renderer/src/components/JobList.tsx
import { useEffect, useState } from 'react';
import type { JobListItem } from '../../../src/electron/ipcTypes';

export interface JobListProps {
  onSelectJob: (jobId: string) => void;
}

export function JobList({ onSelectJob }: JobListProps) {
  const [jobs, setJobs] = useState<JobListItem[]>([]);

  useEffect(() => {
    window.tenderAssist.listJobs().then(setJobs);
  }, []);

  return (
    <div>
      <h1>Jobs</h1>
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Job State</th>
            <th>Auth State</th>
            <th>Created</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.jobId} onClick={() => onSelectJob(job.jobId)} style={{ cursor: 'pointer' }}>
              <td>{job.jobId.slice(0, 8)}</td>
              <td>{job.jobState}</td>
              <td>{job.authState ?? '—'}</td>
              <td>{job.createdAt}</td>
              <td>{job.updatedAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

```tsx
// renderer/src/App.tsx
import { JobList } from './components/JobList';

export function App() {
  // Task 5 replaces this no-op with real job-detail navigation.
  return <JobList onSelectJob={() => {}} />;
}
```

- [ ] **Step 6: Verify manually**

Run: `npm run electron`
Expected: the window shows a "Jobs" table listing every job already in the real app database (there should be at least one row already, from earlier manual `verify:auth` runs), with columns for job id, job state, auth state, and timestamps. No console errors in the Electron window's DevTools (View → Toggle Developer Tools, or Ctrl+Shift+I).

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: clean on all three configs.

- [ ] **Step 8: Commit**

```bash
git add src/electron/ipcTypes.ts src/electron/main.ts src/electron/preload.cts renderer/src/global.d.ts renderer/src/components/JobList.tsx renderer/src/App.tsx
git commit -m "feat: list-jobs IPC handler and Job List screen"
```

---

### Task 5: `get-job-detail` and the Job Detail screen

**Files:**
- Modify: `src/electron/main.ts`
- Create: `renderer/src/components/JobDetail.tsx`
- Modify: `renderer/src/App.tsx`

**Interfaces:**
- Consumes: `JobDetail` (already fully defined in `src/electron/ipcTypes.ts` as of Task 4 Step 1 — Task 4 defined the complete `TenderAssistApi` contract up front, `JobDetail` included, even though the handler behind it didn't exist yet). `StateTransitionRepository.listFor(entityType, entityId)` (existing, `src/persistence/repositories/stateTransitionRepository.ts` — entity types are the literal strings `'JOB'` and `'AUTH_SESSION'`, exactly as `JobStateMachine`/`AuthStateMachine` already write them).
- Produces: a working `get-job-detail` IPC handler and the Job Detail screen. Task 6 extends this screen with live updates and an outcome banner.

No automated tests for this task — verification is manual (Step 4 below).

- [ ] **Step 1: Implement `get-job-detail` in `main.ts`**

Add this handler in `src/electron/main.ts`, anywhere after the existing `list-jobs` handler:

```ts
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
```

Add `JobDetail` to the existing `import type { JobListItem } from './ipcTypes.js';` line (making it `import type { JobListItem, JobDetail } from './ipcTypes.js';`).

- [ ] **Step 2: Write the Job Detail screen**

```tsx
// renderer/src/components/JobDetail.tsx
import { useEffect, useState } from 'react';
import type { JobDetail as JobDetailData } from '../../../src/electron/ipcTypes';

export interface JobDetailProps {
  jobId: string;
  onBack: () => void;
}

export function JobDetail({ jobId, onBack }: JobDetailProps) {
  const [detail, setDetail] = useState<JobDetailData | null>(null);

  useEffect(() => {
    window.tenderAssist.getJobDetail(jobId).then(setDetail);
  }, [jobId]);

  if (!detail) return <p>Loading...</p>;

  return (
    <div>
      <button onClick={onBack}>&larr; Back to jobs</button>
      <h1>Job {detail.jobId.slice(0, 8)}</h1>
      <p>
        Job state: <strong>{detail.jobState}</strong>
      </p>
      <p>
        Auth state: <strong>{detail.authState ?? '—'}</strong>
      </p>

      <h2>Job transitions</h2>
      <ul>
        {detail.jobTransitions.map((t) => (
          <li key={t.id}>
            {t.from_state ?? '(start)'} &rarr; {t.to_state} — {t.reason ?? ''} ({t.occurred_at})
          </li>
        ))}
      </ul>

      <h2>Auth session transitions</h2>
      <ul>
        {detail.authTransitions.map((t) => (
          <li key={t.id}>
            {t.from_state ?? '(start)'} &rarr; {t.to_state} — {t.reason ?? ''} ({t.occurred_at})
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Wire navigation in `App.tsx`**

Replace `renderer/src/App.tsx`'s contents with:

```tsx
// renderer/src/App.tsx
import { useState } from 'react';
import { JobList } from './components/JobList';
import { JobDetail } from './components/JobDetail';

export function App() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  if (selectedJobId) {
    return <JobDetail jobId={selectedJobId} onBack={() => setSelectedJobId(null)} />;
  }
  return <JobList onSelectJob={setSelectedJobId} />;
}
```

- [ ] **Step 4: Verify manually**

Run: `npm run electron`. Click any job row in the list. Expected: the detail screen shows that job's state, its latest auth session's state, and a "Job transitions" list plus an "Auth session transitions" list, each showing `from → to — reason (timestamp)` entries. Cross-check one job's transitions against the database directly:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const dbPath = path.join(process.env.APPDATA, 'TenderAssist', 'tenderassist.db');
const db = new DatabaseSync(dbPath);
const jobId = process.argv[1];
console.log(db.prepare(\"SELECT * FROM state_transitions WHERE entity_type = 'JOB' AND entity_id = ? ORDER BY occurred_at\").all(jobId));
db.close();
" -- <job-id-from-the-ui>
```

Expected: the printed rows match what the detail screen rendered. Click "Back to jobs" — expected: returns to the job list.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: clean on all three configs.

- [ ] **Step 6: Commit**

```bash
git add src/electron/main.ts renderer/src/components/JobDetail.tsx renderer/src/App.tsx
git commit -m "feat: get-job-detail IPC handler and Job Detail screen with audit timeline"
```

---

### Task 6: `start-job`, live updates, and the outcome banner

**Files:**
- Modify: `src/electron/main.ts`
- Modify: `renderer/src/components/JobList.tsx`
- Modify: `renderer/src/components/JobDetail.tsx`

**Interfaces:**
- Consumes: `runAuthJob` (Task 2, `src/orchestration/authJobRunner.ts`), `launchChrome`/`waitForCdpReady` (`src/browser/chromeLauncher.ts`), `getAppDataDir` (`src/config/paths.ts`).
- Produces: a fully working "Start new job" button, live-updating job list and job detail screens, and a job-detail outcome banner. This is the final functional piece of the milestone.

No automated tests for this task — verification is manual (Step 5 below), the same real end-to-end flow already proven by Task 2's `authJobRunner` tests and the pre-existing CLI script, now driven from the UI instead of the terminal.

- [ ] **Step 1: Implement `start-job` in `main.ts`**

Add these imports to the top of `src/electron/main.ts` (alongside the existing ones):

```ts
import { mkdirSync } from 'node:fs';
import { launchChrome, waitForCdpReady } from '../browser/chromeLauncher.js';
import { runAuthJob } from '../orchestration/authJobRunner.js';
import { getAppDataDir } from '../config/paths.js';
```

(`getDatabasePath` is already imported from `'../config/paths.js'` — add `getAppDataDir` to that same import line rather than a new one.)

Add this constant near the top of the file, alongside the other module-level constants:

```ts
const PORTAL_URL = 'https://tntenders.gov.in/nicgep/app';
```

Add this module-level variable, alongside `let mainWindow`:

```ts
let activeJobId: string | null = null;
```

Add the `start-job` handler, anywhere after the existing `get-job-detail` handler:

```ts
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
```

This deliberately does **not** await `runPromise` before returning — `started` resolves as soon as the very first `onUpdate` call fires (right after the auth session reaches `AUTH_PENDING`, a sub-second wait), so `startJob()` returns quickly while the up-to-5-minute polling loop continues in the background, pushing further `job-updated` events until it reaches a terminal outcome.

- [ ] **Step 2: Add the "Start new job" button to the Job List screen**

Replace `renderer/src/components/JobList.tsx`'s contents with:

```tsx
// renderer/src/components/JobList.tsx
import { useCallback, useEffect, useState } from 'react';
import type { AuthJobUpdate, JobListItem } from '../../../src/electron/ipcTypes';

export interface JobListProps {
  onSelectJob: (jobId: string) => void;
}

export function JobList({ onSelectJob }: JobListProps) {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [starting, setStarting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    window.tenderAssist.listJobs().then(setJobs);
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = window.tenderAssist.onJobUpdate((update: AuthJobUpdate) => {
      if (update.outcome) {
        setActiveJobId(null);
        refresh();
      }
    });
    return unsubscribe;
  }, [refresh]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const { jobId } = await window.tenderAssist.startJob();
      setActiveJobId(jobId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div>
      <h1>Jobs</h1>
      <button onClick={handleStart} disabled={starting || activeJobId !== null}>
        {activeJobId ? 'Job running…' : 'Start new job'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Job State</th>
            <th>Auth State</th>
            <th>Created</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.jobId} onClick={() => onSelectJob(job.jobId)} style={{ cursor: 'pointer' }}>
              <td>{job.jobId.slice(0, 8)}</td>
              <td>{job.jobState}</td>
              <td>{job.authState ?? '—'}</td>
              <td>{job.createdAt}</td>
              <td>{job.updatedAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Add live updates and the outcome banner to the Job Detail screen**

Replace `renderer/src/components/JobDetail.tsx`'s contents with:

```tsx
// renderer/src/components/JobDetail.tsx
import { useEffect, useState } from 'react';
import type { AuthJobUpdate, JobDetail as JobDetailData } from '../../../src/electron/ipcTypes';

export interface JobDetailProps {
  jobId: string;
  onBack: () => void;
}

export function JobDetail({ jobId, onBack }: JobDetailProps) {
  const [detail, setDetail] = useState<JobDetailData | null>(null);
  const [latestUpdate, setLatestUpdate] = useState<AuthJobUpdate | null>(null);

  useEffect(() => {
    window.tenderAssist.getJobDetail(jobId).then(setDetail);
  }, [jobId]);

  useEffect(() => {
    const unsubscribe = window.tenderAssist.onJobUpdate((update) => {
      if (update.jobId !== jobId) return;
      setLatestUpdate(update);
      window.tenderAssist.getJobDetail(jobId).then(setDetail);
    });
    return unsubscribe;
  }, [jobId]);

  if (!detail) return <p>Loading...</p>;

  const bannerColor =
    latestUpdate?.outcome === 'SUCCESS' ? 'green' : latestUpdate?.outcome === 'ABORTED' ? 'red' : 'gray';

  return (
    <div>
      <button onClick={onBack}>&larr; Back to jobs</button>
      <h1>Job {detail.jobId.slice(0, 8)}</h1>
      {latestUpdate?.outcome && (
        <p style={{ color: bannerColor, fontWeight: 'bold' }}>
          {latestUpdate.outcome}
          {latestUpdate.abortReason ? `: ${latestUpdate.abortReason}` : ''}
        </p>
      )}
      <p>
        Job state: <strong>{detail.jobState}</strong>
      </p>
      <p>
        Auth state: <strong>{detail.authState ?? '—'}</strong>
      </p>

      <h2>Job transitions</h2>
      <ul>
        {detail.jobTransitions.map((t) => (
          <li key={t.id}>
            {t.from_state ?? '(start)'} &rarr; {t.to_state} — {t.reason ?? ''} ({t.occurred_at})
          </li>
        ))}
      </ul>

      <h2>Auth session transitions</h2>
      <ul>
        {detail.authTransitions.map((t) => (
          <li key={t.id}>
            {t.from_state ?? '(start)'} &rarr; {t.to_state} — {t.reason ?? ''} ({t.occurred_at})
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: clean on all three configs.

- [ ] **Step 5: Verify manually, end-to-end**

Run: `npm run electron`. Click "Start new job". Expected, in order:
1. A real Chrome window opens, navigated to `https://tntenders.gov.in/nicgep/app`.
2. The "Start new job" button becomes disabled and reads "Job running…".
3. Clicking into the new job's row (it should appear at the top of the list within a few seconds) shows its detail screen with `jobState: AUTH_PENDING` and a growing job-transitions list, updating live without needing to click "Back" and back in again.
4. Either wait up to 5 minutes for a `TIMEOUT` banner (gray) to appear, or manually close the Chrome window to trigger an `ABORTED` banner (red, mentioning `TAB_LOST`) — either way, confirm the "Start new job" button re-enables once the outcome lands.
5. Confirm the real database reflects the same final state shown in the UI:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const dbPath = path.join(process.env.APPDATA, 'TenderAssist', 'tenderassist.db');
const db = new DatabaseSync(dbPath);
console.log(db.prepare('SELECT id, state FROM jobs ORDER BY created_at DESC LIMIT 1').all());
db.close();
"
```

- [ ] **Step 6: Commit**

```bash
git add src/electron/main.ts renderer/src/components/JobList.tsx renderer/src/components/JobDetail.tsx
git commit -m "feat: start-job IPC handler, live job updates, and outcome banner"
```

---

### Task 7: Final end-to-end verification pass

**Files:** none (verification only; fix forward in the relevant file from Tasks 1-6 if this step surfaces a real bug).

- [ ] **Step 1: Run the full automated suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: 128/128 passing (all of Tasks 1-2's new tests plus every prior plan's test), typecheck clean on all three configs (root, test, renderer).

- [ ] **Step 2: Repeat Task 6's manual end-to-end walkthrough once more, uninterrupted**

Run `npm run electron` and go through: start a job → watch it appear and update live in both screens → let it resolve (TIMEOUT, ABORTED, or — if you complete a real login — SUCCESS) → confirm the database's final row matches the UI. This is the same walkthrough as Task 6 Step 5, repeated here as a clean final pass after all tasks are in, not a new scenario.

- [ ] **Step 3: Fix forward if anything surfaced**

If Step 2 reveals a real defect, fix it in the relevant file from Tasks 1-6, re-run the affected automated tests (if any) plus Step 1's full suite, and re-run the manual walkthrough once more before proceeding. If everything already worked, there is nothing to do here.

- [ ] **Step 4: Commit (only if Step 3 made changes)**

```bash
git add -A
git commit -m "fix: address issue found during Electron dashboard end-to-end verification"
```

(Skip this step entirely if Step 3 found nothing to fix.)

## Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-09-18-electron-dashboard-design.md` maps to a task — architecture (Tasks 3-6), both screens (Tasks 4-6), the full IPC contract (Tasks 4-6), error handling (Task 6's error state + outcome banner), and testing approach (Task 2's automated `authJobRunner` coverage; Tasks 3-7's manual verification steps for everything else, exactly as the spec's own Testing section calls for).
- **Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code; Task 7 is verification-only by design (matching the spec's own manual-verification approach), not a placeholder.
- **Type consistency:** `AuthJobUpdate` (Task 2) is defined once and re-exported unchanged through `ipcTypes.ts` (Task 4) rather than redeclared; `JobListItem`/`JobDetail`/`TenderAssistApi` are each defined exactly once (Tasks 4-5) and consumed with identical shapes by `main.ts`'s IPC handlers, `preload.cts`, and every renderer component that touches them.
- **Single-active-job constraint:** implemented in Task 6's `start-job` handler (`activeJobId` guard) and surfaced in the Job List screen's disabled button state, per the design spec's explicit requirement.

## Next Milestone

Not yet planned: wiring live search execution (Plan 6, not yet written) into this same UI — a "Searches" tab or section on the job detail screen, once Plan 6 actually builds the search-execution orchestrator this dashboard would drive.
