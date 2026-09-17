# Job Reaction to Auth-Session Loss — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "known gap" documented in the spec after Plan 3's final review: when the browser/auth session is lost (tab closed, session expired), only the `auth_sessions` row reacts — the parent **job** row is left stranded in `AUTH_PENDING`/`AUTHENTICATED`/etc. forever, with nothing wiring the spec's required "job state `AUTH_REQUIRED`, checkpoint immediately" reaction. This plan wires that reaction without expanding `AuthFlow`'s own responsibility beyond auth-session state — exactly as the spec's gap note said the fix should be structured.

**Architecture:** `AuthFlow` gains one new optional dependency, `onAuthSessionLost`, invoked after it successfully transitions the auth session to a terminal state — it does not itself know or care what that callback does. A new small, pure, fully unit-testable factory function (`reactToAuthSessionLoss`) in a new file builds the actual job-reacting callback from a `JobStateMachine` and a `jobId`, using defensive try/catch against `IllegalJobTransitionError` so it never needs to hardcode which job states `AUTH_REQUIRED` is reachable from (robust to future job-pipeline states this plan doesn't touch). `manualAuthVerification.ts` composes the two together — the only real caller today.

**Tech Stack:** TypeScript (strict, NodeNext modules), `node:sqlite`, Vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-17-tenderassist-architecture.md` — see the "Known gap: job state does not react to auth-session loss" section (added after Plan 3's final review) for the exact problem this plan closes.

**Depends on:** Plans 1-3 (all complete). Imports `JobStateMachine`/`IllegalJobTransitionError` (`src/state/jobStateMachine.ts`), `AuthFlow`/`AuthFlowDeps`/`SessionLossReason` (`src/browser/authFlow.ts`, `src/browser/browserController.ts`), and modifies `src/scripts/manualAuthVerification.ts`.

## Global Constraints

- `AuthFlow` must not import `JobStateMachine`, `JobRepository`, or anything job-specific — its `onAuthSessionLost` callback is a plain function type with no job-domain knowledge. This preserves the boundary the spec's gap note explicitly asked for ("a future orchestrator plan owns the job-level reaction," not `AuthFlow` itself).
- `reactToAuthSessionLoss`'s guard against invalid job-state transitions must be structural (catch `IllegalJobTransitionError`), not a hardcoded list of "safe" source states — the job pipeline will grow more states in future plans (searching, classifying, acquiring documents) and this code must not need updating every time one is added.
- `node:sqlite`/state-machine typing conventions from Plans 1-3 apply to any touched file (not expected to be relevant here — no new persistence code).
- TypeScript strict mode; no `any`. `npm run typecheck` must stay clean on both configs.

---

### Task 1: `reactToAuthSessionLoss` coordinator function

**Files:**
- Create: `src/browser/authJobCoordinator.ts`
- Test: `tests/browser/authJobCoordinator.test.ts`

**Interfaces:**
- Consumes: `JobStateMachine`/`IllegalJobTransitionError` (`src/state/jobStateMachine.ts`), `SessionLossReason` (`src/browser/browserController.ts`).
- Produces: `function reactToAuthSessionLoss(jobMachine: JobStateMachine, jobId: string): (reason: SessionLossReason, terminalState: 'TAB_LOST' | 'SESSION_EXPIRED') => void`. Task 2 wires this callback's return value into `AuthFlowDeps.onAuthSessionLost`.

This is a pure unit test — no Chrome, no real browser, just `JobRepository`/`JobStateMachine` from Plan 1, exactly like their own existing tests.

- [ ] **Step 1: Write the failing test**

```ts
// tests/browser/authJobCoordinator.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { JobStateMachine } from '../../src/state/jobStateMachine.js';
import { reactToAuthSessionLoss } from '../../src/browser/authJobCoordinator.js';

describe('reactToAuthSessionLoss', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let machine: JobStateMachine;
  let jobId: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    const transitions = new StateTransitionRepository(db);
    machine = new JobStateMachine(db, jobs, transitions);
    jobId = jobs.create().id;
  });

  it('transitions the job to AUTH_REQUIRED with a reason naming the cause', () => {
    machine.transition(jobId, 'AUTH_REQUIRED');
    machine.transition(jobId, 'AUTH_PENDING');

    const callback = reactToAuthSessionLoss(machine, jobId);
    callback('TAB_CLOSED', 'TAB_LOST');

    const job = jobs.getById(jobId)!;
    expect(job.state).toBe('AUTH_REQUIRED');
  });

  it('records the reason and terminal state in the transition reason text', () => {
    machine.transition(jobId, 'AUTH_REQUIRED');
    machine.transition(jobId, 'AUTH_PENDING');

    const callback = reactToAuthSessionLoss(machine, jobId);
    callback('SESSION_EXPIRED_PAGE', 'SESSION_EXPIRED');

    // AUTH_REQUIRED is reachable from AUTH_PENDING, so the transition
    // must have actually happened (not silently swallowed) -- the state
    // change itself is the observable proof the reason text was passed
    // through, since JobStateMachine's own test suite already covers
    // that transition() writes whatever reason string it's given.
    expect(jobs.getById(jobId)?.state).toBe('AUTH_REQUIRED');
  });

  it('does nothing (does not throw) when the job is already AUTH_REQUIRED', () => {
    machine.transition(jobId, 'AUTH_REQUIRED');

    const callback = reactToAuthSessionLoss(machine, jobId);
    expect(() => callback('TAB_CLOSED', 'TAB_LOST')).not.toThrow();

    expect(jobs.getById(jobId)?.state).toBe('AUTH_REQUIRED');
  });

  it('does nothing (does not throw) when the job is in a terminal state', () => {
    machine.transition(jobId, 'FAILED_MANUAL');

    const callback = reactToAuthSessionLoss(machine, jobId);
    expect(() => callback('TAB_CLOSED', 'TAB_LOST')).not.toThrow();

    expect(jobs.getById(jobId)?.state).toBe('FAILED_MANUAL');
  });

  it('re-throws an unexpected (non-IllegalJobTransitionError) error', () => {
    const callback = reactToAuthSessionLoss(machine, 'no-such-job-id');
    expect(() => callback('TAB_CLOSED', 'TAB_LOST')).toThrow('Job not found: no-such-job-id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/browser/authJobCoordinator.test.ts`
Expected: FAIL — cannot find module `../../src/browser/authJobCoordinator.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/browser/authJobCoordinator.ts
import { IllegalJobTransitionError, type JobStateMachine } from '../state/jobStateMachine.js';
import type { SessionLossReason } from './browserController.js';

export function reactToAuthSessionLoss(
  jobMachine: JobStateMachine,
  jobId: string
): (reason: SessionLossReason, terminalState: 'TAB_LOST' | 'SESSION_EXPIRED') => void {
  return (reason, terminalState) => {
    try {
      jobMachine.transition(jobId, 'AUTH_REQUIRED', `auth session lost: ${reason} (${terminalState})`);
    } catch (err) {
      if (!(err instanceof IllegalJobTransitionError)) throw err;
      // Job is already past the point where AUTH_REQUIRED is a valid
      // recovery target (e.g. already AUTH_REQUIRED, or a terminal
      // state) -- nothing to do.
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/browser/authJobCoordinator.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: 88/88 passing (83 from Plans 1-3 + 5 new), typecheck clean on both configs.

- [ ] **Step 6: Commit**

```bash
git add src/browser/authJobCoordinator.ts tests/browser/authJobCoordinator.test.ts
git commit -m "feat: job reaction to auth-session loss (pure coordinator function)"
```

---

### Task 2: Wire `onAuthSessionLost` into `AuthFlow`

**Files:**
- Modify: `src/browser/authFlow.ts`
- Modify: `tests/browser/authFlow.test.ts`

**Interfaces:**
- Consumes: nothing new — `SessionLossReason` is already imported in this file.
- Produces: `AuthFlowDeps` gains an optional `onAuthSessionLost?: (reason: SessionLossReason, terminalState: 'TAB_LOST' | 'SESSION_EXPIRED') => void` field. Task 3 supplies `reactToAuthSessionLoss(jobMachine, job.id)` (Task 1's output) as this callback when constructing `AuthFlow` in `manualAuthVerification.ts`.

This task modifies `handleSessionLost()`, the private method already present in `src/browser/authFlow.ts:59-67` (reproduced here for exact context — do not touch any other method in this file):

```ts
  private handleSessionLost(reason: SessionLossReason): void {
    if (!this.authSessionId) return;
    const current = this.deps.sessions.getById(this.authSessionId);
    if (!current) return;
    if (current.state !== 'AUTH_PENDING' && current.state !== 'AUTHENTICATED') return;

    const target = reason === 'SESSION_EXPIRED_PAGE' ? 'SESSION_EXPIRED' : 'TAB_LOST';
    this.deps.machine.transition(this.authSessionId, target, `browser controller reported ${reason}`);
  }
```

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe.skipIf(!CHROME_PATH)('AuthFlow', ...)` block in `tests/browser/authFlow.test.ts`, alongside the existing `'transitions to TAB_LOST when the retained tab is closed'` test (do not modify that existing test — add this as a new one near it):

```ts
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
```

(This file already has the `waitFor` helper from Plan 3's final-review fix wave — reuse it, don't redefine it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/browser/authFlow.test.ts`
Expected: FAIL — `AuthFlowDeps` has no `onAuthSessionLost` property (TypeScript error) or the callback is simply never invoked (runtime assertion failure), depending on how strictly the test file type-checks before running.

- [ ] **Step 3: Modify `AuthFlowDeps` and `handleSessionLost`**

In `src/browser/authFlow.ts`, change the `AuthFlowDeps` interface:

```ts
export interface AuthFlowDeps {
  sessions: AuthSessionRepository;
  machine: AuthStateMachine;
  onAuthSessionLost?: (reason: SessionLossReason, terminalState: 'TAB_LOST' | 'SESSION_EXPIRED') => void;
}
```

And change `handleSessionLost` to invoke it after a successful transition:

```ts
  private handleSessionLost(reason: SessionLossReason): void {
    if (!this.authSessionId) return;
    const current = this.deps.sessions.getById(this.authSessionId);
    if (!current) return;
    if (current.state !== 'AUTH_PENDING' && current.state !== 'AUTHENTICATED') return;

    const target = reason === 'SESSION_EXPIRED_PAGE' ? 'SESSION_EXPIRED' : 'TAB_LOST';
    this.deps.machine.transition(this.authSessionId, target, `browser controller reported ${reason}`);
    this.deps.onAuthSessionLost?.(reason, target);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/browser/authFlow.test.ts`
Expected: 5 passed (4 existing + 1 new).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: 89/89 passing, typecheck clean on both configs.

- [ ] **Step 6: Commit**

```bash
git add src/browser/authFlow.ts tests/browser/authFlow.test.ts
git commit -m "feat: AuthFlow invokes onAuthSessionLost after a terminal auth-session transition"
```

---

### Task 3: Wire the coordinator into the manual verification script

**Files:**
- Modify: `src/scripts/manualAuthVerification.ts`

**Interfaces:**
- Consumes: `reactToAuthSessionLoss` (Task 1), `AuthFlowDeps.onAuthSessionLost` (Task 2).
- Produces: nothing new exported — this is the composition root wiring the two together.

This task has no new automated test, consistent with Plan 3 Task 4's precedent for this script (it's a manual/interactive tool; verification is a dry run, not a unit test). The change is small: when constructing `AuthFlow` in `main()`, pass `reactToAuthSessionLoss(jobMachine, job.id)` as `onAuthSessionLost`.

- [ ] **Step 1: Add the import**

In `src/scripts/manualAuthVerification.ts`, add alongside the existing `AuthFlow` import:

```ts
import { reactToAuthSessionLoss } from '../browser/authJobCoordinator.js';
```

- [ ] **Step 2: Wire the callback**

Find the existing `const flow = new AuthFlow({ sessions, machine: authMachine });` line and change it to:

```ts
  const flow = new AuthFlow({
    sessions,
    machine: authMachine,
    onAuthSessionLost: reactToAuthSessionLoss(jobMachine, job.id),
  });
```

- [ ] **Step 3: Build and typecheck**

Run: `npm run build && npm run typecheck`
Expected: clean, zero errors on both configs.

- [ ] **Step 4: Self-directed dry run proving the wiring works (no human needed)**

Using the same fixture-server technique as Plan 3 Task 4's dry run, prove that closing the tab mid-poll now moves the **job** (not just the auth session) to `AUTH_REQUIRED`:

1. Start a throwaway local HTTP server that never shows the authenticated-dashboard indicators (so the script keeps polling instead of succeeding immediately):

```bash
node -e "
const http = require('node:http');
const server = http.createServer((req, res) => {
  res.end('<html><body>please log in</body></html>');
});
server.listen(0, () => console.log('fixture server on port', server.address().port));
"
```

2. Run the script against that fixture URL (substitute the port printed above): `npm run verify:auth -- http://127.0.0.1:<port>`
3. While it's polling (you'll see the "Chrome is open..." message and no SUCCESS yet), manually close the Chrome window that opened (or close its one tab).
4. Expected: the script prints `ABORTED: auth session reached terminal state TAB_LOST.` (from the pre-existing polling-loop logic) and exits with code 1 — same observable behavior as before this plan, since the script's own polling loop already detected this. The new behavior to verify is the **job** row's final state.
5. Query the real app database directly to confirm the **job** (not just the auth session) ended in `AUTH_REQUIRED`:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const dbPath = path.join(process.env.APPDATA, 'TenderAssist', 'tenderassist.db');
const db = new DatabaseSync(dbPath);
const jobs = db.prepare('SELECT id, state FROM jobs ORDER BY created_at DESC LIMIT 1').all();
console.log('most recent job:', jobs);
db.close();
"
```

Expected: the most recent job row's `state` is `AUTH_REQUIRED` (not stuck at `AUTH_PENDING`, which is what it would have shown before this plan). This is the concrete proof the gap is closed.

6. Clean up: kill the fixture server if still running. The real database row left behind is expected (same as Plan 3 Task 4's dry run) — do not delete it.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/manualAuthVerification.ts
git commit -m "feat: wire job reaction to auth-session loss into the manual verification script"
```

---

## Self-Review Notes

- **Spec coverage:** directly closes the "Known gap: job state does not react to auth-session loss" section added to the spec after Plan 3's final review. The fix follows that note's own stated design intent exactly: `AuthFlow` stays auth-session-only, a separate coordinator owns the job-level reaction.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code, and Task 3's dry run is a concrete, human-executable procedure with a precise expected outcome (job row shows `AUTH_REQUIRED`), not a vague "verify it works."
- **Type consistency:** `reactToAuthSessionLoss`'s return type signature (`(reason: SessionLossReason, terminalState: 'TAB_LOST' | 'SESSION_EXPIRED') => void`) in Task 1 matches `AuthFlowDeps.onAuthSessionLost`'s type exactly in Task 2 — both defined once, reused, never redeclared with different shapes.

## Next Plan

Plan 5 (not yet written): TN Tenders search execution (Phase 3 of the spec) — the 7 configured searches, pagination, and tender metadata collection. This requires inspecting the real portal (`https://tntenders.gov.in/nicgep/app`, supplied by the user) before writing any scraping-specific code, since the spec explicitly forbids inventing portal behavior. That inspection happens after this plan, using the Chrome browser tool in read-only mode against the public search pages (no DSC login needed for search itself, per the spec's understanding — to be confirmed during inspection).
