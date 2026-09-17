# Auth Foundation: Session Persistence + State Machine + Detection Logic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fully unit-testable foundation pieces for TN Tenders authentication — the `auth_sessions` persistence layer, its state machine, and the two pure-function detectors (authenticated-dashboard indicators, session-expired page) — plus Chrome path/launch-argument resolution. This plan deliberately excludes live browser automation (CDP attach, tab retention, navigation) — that requires real Chrome integration tests and is scoped to Plan 3, so this plan can be fully verified by an automated test suite alone.

**Architecture:** Same conventions as Plan 1: TypeScript strict, `node:sqlite`'s `DatabaseSync`, repositories own all SQL, state machines are the sole owners of their entity's state transitions with transactional audit logging via the existing `StateTransitionRepository`. The two detectors and the Chrome path/args resolution are pure functions with no I/O side effects (or, for `resolveChromePath`, injectable I/O), so they need no mocking framework — real inputs, real assertions.

**Tech Stack:** TypeScript (strict, NodeNext modules), `node:sqlite`, Vitest. No new runtime dependency in this plan — `playwright-core` is deferred to Plan 3, where it's actually used.

**Spec:** `docs/superpowers/specs/2026-09-17-tenderassist-architecture.md`

**Depends on:** `docs/superpowers/plans/2026-09-17-poc-plan1-foundation.md` (complete) — this plan imports `createDatabase`, `withTransaction`, `runMigrations` from `src/persistence/db.ts`/`migrate.ts`, and `StateTransitionRepository` from `src/persistence/repositories/stateTransitionRepository.ts`, and reuses `JobRepository` in tests to create a real parent job row (the `auth_sessions` table has a foreign key to `jobs`, and `PRAGMA foreign_keys = ON` is set).

## Global Constraints

- No native (node-gyp/C++-compiled) npm dependency — this plan adds none. `playwright-core` (needed for Plan 3) does not require native compilation and was verified to install cleanly on this machine, but it is NOT added here since nothing in this plan uses it yet (YAGNI — don't add a dependency before the task that needs it).
- `node:sqlite`'s typing pattern applies to all new repository code: positional parameter binding for `.run()` (not named-object `@x` placeholders), and `unknown`-first casts for array results from `.all()` (`as unknown as T[]`) — single-object `.get()` casts don't need the `unknown` step.
- Every state transition must be recorded in `state_transitions` in the same transaction as the state update, via the existing generic `StateTransitionRepository` — reuse it, do not build a parallel audit mechanism.
- TypeScript strict mode; no `any` in production code. `npm run typecheck` (which now runs both `tsconfig.json` and `tsconfig.test.json`) must stay clean — this covers `tests/` too, not just `src/`.
- Detector functions (`isAuthenticatedDashboard`, `isSessionExpiredPage`) must be pure — no DOM access, no Playwright types, no I/O. They take plain strings (page text / URL) and return a boolean. This is deliberate: it lets Plan 3's browser-controller code extract text from a real `Page` and hand it to these functions, keeping the "what counts as authenticated" logic testable without a browser.
- `resolveChromePath` must accept injectable candidate-path and existence-check parameters (defaulting to the real Windows paths and `node:fs`'s `existsSync`) so its search logic is testable without depending on this exact machine's Chrome install location.

---

### Task 1: AuthSessionRepository + migration

**Files:**
- Create: `src/persistence/migrations/002_auth_sessions.sql`
- Create: `src/persistence/repositories/authSessionRepository.ts`
- Test: `tests/persistence/repositories/authSessionRepository.test.ts`

**Interfaces:**
- Consumes: `createDatabase`/`runMigrations`/`withTransaction` from `src/persistence/db.ts`/`migrate.ts` (Plan 1), `JobRepository` (Plan 1, test setup only — to create a real parent job row).
- Produces: `type AuthState = 'NOT_STARTED' | 'AUTH_PENDING' | 'AUTHENTICATED' | 'SESSION_EXPIRED' | 'TAB_LOST'`; `interface AuthSessionRow { id: string; job_id: string; state: AuthState; cdp_target_id: string | null; authenticated_at: string | null; created_at: string; updated_at: string }`; `class AuthSessionRepository { create(jobId: string): AuthSessionRow; getById(id: string): AuthSessionRow | undefined; getLatestForJob(jobId: string): AuthSessionRow | undefined; updateState(id: string, state: AuthState): void; setCdpTargetId(id: string, targetId: string): void; markAuthenticatedAt(id: string, timestamp: string): void }`. Task 2's `AuthStateMachine` depends on this exact shape.

- [ ] **Step 1: Write the failing test**

```ts
// tests/persistence/repositories/authSessionRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../../src/persistence/repositories/authSessionRepository.js';

describe('AuthSessionRepository', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let repo: AuthSessionRepository;
  let jobId: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    repo = new AuthSessionRepository(db);
    jobId = jobs.create().id;
  });

  it('creates an auth session in NOT_STARTED state, linked to the job', () => {
    const session = repo.create(jobId);
    expect(session.state).toBe('NOT_STARTED');
    expect(session.job_id).toBe(jobId);
    expect(session.cdp_target_id).toBeNull();
    expect(session.authenticated_at).toBeNull();
  });

  it('returns undefined for an unknown id', () => {
    expect(repo.getById('does-not-exist')).toBeUndefined();
  });

  it('getLatestForJob returns the most recently created session for that job', () => {
    repo.create(jobId);
    const second = repo.create(jobId);

    const latest = repo.getLatestForJob(jobId);
    expect(latest?.id).toBe(second.id);
  });

  it('getLatestForJob returns undefined when the job has no sessions', () => {
    const otherJobId = jobs.create().id;
    expect(repo.getLatestForJob(otherJobId)).toBeUndefined();
  });

  it('updateState changes state and bumps updated_at', async () => {
    const session = repo.create(jobId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    repo.updateState(session.id, 'AUTH_PENDING');

    const fetched = repo.getById(session.id)!;
    expect(fetched.state).toBe('AUTH_PENDING');
    expect(fetched.updated_at).not.toBe(session.updated_at);
  });

  it('setCdpTargetId persists the target id', () => {
    const session = repo.create(jobId);
    repo.setCdpTargetId(session.id, 'target-abc');

    expect(repo.getById(session.id)?.cdp_target_id).toBe('target-abc');
  });

  it('markAuthenticatedAt persists the timestamp', () => {
    const session = repo.create(jobId);
    repo.markAuthenticatedAt(session.id, '2026-09-17T10:00:00.000Z');

    expect(repo.getById(session.id)?.authenticated_at).toBe('2026-09-17T10:00:00.000Z');
  });

  it('rejects an auth session for a non-existent job (foreign key)', () => {
    expect(() => repo.create('no-such-job')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/persistence/repositories/authSessionRepository.test.ts`
Expected: FAIL — cannot find module `../../../src/persistence/repositories/authSessionRepository.js`.

- [ ] **Step 3: Write the migration**

```sql
-- src/persistence/migrations/002_auth_sessions.sql
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  state TEXT NOT NULL,
  cdp_target_id TEXT,
  authenticated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs (id)
);

CREATE INDEX idx_auth_sessions_job_id ON auth_sessions (job_id);
```

- [ ] **Step 4: Write the repository**

```ts
// src/persistence/repositories/authSessionRepository.ts
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type AuthState = 'NOT_STARTED' | 'AUTH_PENDING' | 'AUTHENTICATED' | 'SESSION_EXPIRED' | 'TAB_LOST';

export interface AuthSessionRow {
  id: string;
  job_id: string;
  state: AuthState;
  cdp_target_id: string | null;
  authenticated_at: string | null;
  created_at: string;
  updated_at: string;
}

export class AuthSessionRepository {
  constructor(private db: DatabaseSync) {}

  create(jobId: string): AuthSessionRow {
    const now = new Date().toISOString();
    const row: AuthSessionRow = {
      id: randomUUID(),
      job_id: jobId,
      state: 'NOT_STARTED',
      cdp_target_id: null,
      authenticated_at: null,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO auth_sessions (id, job_id, state, cdp_target_id, authenticated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(row.id, row.job_id, row.state, row.cdp_target_id, row.authenticated_at, row.created_at, row.updated_at);
    return row;
  }

  getById(id: string): AuthSessionRow | undefined {
    return this.db.prepare('SELECT * FROM auth_sessions WHERE id = ?').get(id) as
      | AuthSessionRow
      | undefined;
  }

  getLatestForJob(jobId: string): AuthSessionRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM auth_sessions WHERE job_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
      )
      .get(jobId) as AuthSessionRow | undefined;
  }

  updateState(id: string, state: AuthState): void {
    this.db
      .prepare('UPDATE auth_sessions SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, new Date().toISOString(), id);
  }

  setCdpTargetId(id: string, targetId: string): void {
    this.db
      .prepare('UPDATE auth_sessions SET cdp_target_id = ?, updated_at = ? WHERE id = ?')
      .run(targetId, new Date().toISOString(), id);
  }

  markAuthenticatedAt(id: string, timestamp: string): void {
    this.db
      .prepare('UPDATE auth_sessions SET authenticated_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, new Date().toISOString(), id);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/persistence/repositories/authSessionRepository.test.ts`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add src/persistence/migrations/002_auth_sessions.sql src/persistence/repositories/authSessionRepository.ts tests/persistence/repositories/authSessionRepository.test.ts
git commit -m "feat: auth session repository and migration"
```

---

### Task 2: AuthStateMachine

**Files:**
- Create: `src/state/authStateMachine.ts`
- Test: `tests/state/authStateMachine.test.ts`

**Interfaces:**
- Consumes: `AuthSessionRepository`/`AuthSessionRow`/`AuthState` from Task 1, `StateTransitionRepository` from Plan 1, `withTransaction` from Plan 1's `src/persistence/db.ts`.
- Produces: `class IllegalAuthTransitionError extends Error`; `class AuthStateMachine { constructor(db: DatabaseSync, sessions: AuthSessionRepository, transitions: StateTransitionRepository); transition(authSessionId: string, to: AuthState, reason?: string): void }`. Transitioning to `'AUTHENTICATED'` must also call `sessions.markAuthenticatedAt(id, <transition timestamp>)` inside the same transaction. This mirrors `JobStateMachine` exactly — it is the sole owner of `auth_sessions.state` changes; no later task should call `AuthSessionRepository.updateState` directly (mark it `@internal` the same way `JobRepository.updateState` is marked).

Transition table (SESSION_EXPIRED and TAB_LOST are both terminal for a given auth_sessions row — per the spec, retrying reauthentication creates a NEW row via `AuthSessionRepository.create()`, it does not reset an existing row back to `AUTH_PENDING`; this keeps every authentication attempt independently auditable, the same way Job state transitions are never overwritten):

```ts
const VALID_AUTH_TRANSITIONS: Record<AuthState, AuthState[]> = {
  NOT_STARTED: ['AUTH_PENDING'],
  AUTH_PENDING: ['AUTHENTICATED', 'SESSION_EXPIRED', 'TAB_LOST'],
  AUTHENTICATED: ['SESSION_EXPIRED', 'TAB_LOST'],
  SESSION_EXPIRED: [],
  TAB_LOST: [],
};
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/state/authStateMachine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../src/persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { AuthStateMachine, IllegalAuthTransitionError } from '../../src/state/authStateMachine.js';

describe('AuthStateMachine', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let sessions: AuthSessionRepository;
  let transitions: StateTransitionRepository;
  let machine: AuthStateMachine;
  let jobId: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    sessions = new AuthSessionRepository(db);
    transitions = new StateTransitionRepository(db);
    machine = new AuthStateMachine(db, sessions, transitions);
    jobId = jobs.create().id;
  });

  it('allows NOT_STARTED -> AUTH_PENDING and records it in the audit log', () => {
    const session = sessions.create(jobId);
    machine.transition(session.id, 'AUTH_PENDING', 'human opened login page');

    expect(sessions.getById(session.id)?.state).toBe('AUTH_PENDING');
    const log = transitions.listFor('AUTH_SESSION', session.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      from_state: 'NOT_STARTED',
      to_state: 'AUTH_PENDING',
      reason: 'human opened login page',
    });
  });

  it('sets authenticated_at when transitioning to AUTHENTICATED', () => {
    const session = sessions.create(jobId);
    machine.transition(session.id, 'AUTH_PENDING');
    machine.transition(session.id, 'AUTHENTICATED');

    const fetched = sessions.getById(session.id)!;
    expect(fetched.state).toBe('AUTHENTICATED');
    expect(fetched.authenticated_at).not.toBeNull();
  });

  it('does not set authenticated_at for a non-AUTHENTICATED transition', () => {
    const session = sessions.create(jobId);
    machine.transition(session.id, 'AUTH_PENDING');

    expect(sessions.getById(session.id)?.authenticated_at).toBeNull();
  });

  it('rejects an invalid transition and leaves state unchanged', () => {
    const session = sessions.create(jobId);
    expect(() => machine.transition(session.id, 'AUTHENTICATED')).toThrow(IllegalAuthTransitionError);
    expect(sessions.getById(session.id)?.state).toBe('NOT_STARTED');
    expect(transitions.listFor('AUTH_SESSION', session.id)).toHaveLength(0);
  });

  it('rejects any transition out of a terminal state (SESSION_EXPIRED)', () => {
    const session = sessions.create(jobId);
    machine.transition(session.id, 'AUTH_PENDING');
    machine.transition(session.id, 'SESSION_EXPIRED');

    expect(() => machine.transition(session.id, 'AUTH_PENDING')).toThrow(IllegalAuthTransitionError);
  });

  it('throws for an unknown auth session id', () => {
    expect(() => machine.transition('missing-session', 'AUTH_PENDING')).toThrow(
      'Auth session not found: missing-session'
    );
  });

  it('allows AUTHENTICATED -> TAB_LOST', () => {
    const session = sessions.create(jobId);
    machine.transition(session.id, 'AUTH_PENDING');
    machine.transition(session.id, 'AUTHENTICATED');
    machine.transition(session.id, 'TAB_LOST');

    expect(sessions.getById(session.id)?.state).toBe('TAB_LOST');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/state/authStateMachine.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/state/authStateMachine.ts
import type { DatabaseSync } from 'node:sqlite';
import type { AuthSessionRepository, AuthState } from '../persistence/repositories/authSessionRepository.js';
import type { StateTransitionRepository } from '../persistence/repositories/stateTransitionRepository.js';
import { withTransaction } from '../persistence/db.js';

const VALID_AUTH_TRANSITIONS: Record<AuthState, AuthState[]> = {
  NOT_STARTED: ['AUTH_PENDING'],
  AUTH_PENDING: ['AUTHENTICATED', 'SESSION_EXPIRED', 'TAB_LOST'],
  AUTHENTICATED: ['SESSION_EXPIRED', 'TAB_LOST'],
  SESSION_EXPIRED: [],
  TAB_LOST: [],
};

export class IllegalAuthTransitionError extends Error {
  constructor(from: AuthState, to: AuthState) {
    super(`Illegal auth session state transition: ${from} -> ${to}`);
    this.name = 'IllegalAuthTransitionError';
  }
}

export class AuthStateMachine {
  constructor(
    private db: DatabaseSync,
    private sessions: AuthSessionRepository,
    private transitions: StateTransitionRepository
  ) {}

  transition(authSessionId: string, to: AuthState, reason?: string): void {
    const session = this.sessions.getById(authSessionId);
    if (!session) throw new Error(`Auth session not found: ${authSessionId}`);

    const allowed = VALID_AUTH_TRANSITIONS[session.state] ?? [];
    if (!allowed.includes(to)) {
      throw new IllegalAuthTransitionError(session.state, to);
    }

    withTransaction(this.db, () => {
      this.sessions.updateState(authSessionId, to);
      if (to === 'AUTHENTICATED') {
        this.sessions.markAuthenticatedAt(authSessionId, new Date().toISOString());
      }
      this.transitions.record('AUTH_SESSION', authSessionId, session.state, to, reason);
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/state/authStateMachine.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Add the `@internal` marker to `AuthSessionRepository.updateState`**

Edit `src/persistence/repositories/authSessionRepository.ts`, add directly above `updateState`:

```ts
  /** @internal Use AuthStateMachine.transition() instead — calling this directly skips transition validation and the audit-log write. */
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests pass (31 from Plan 1 + 8 from Task 1 + 7 from Task 2 = 46), pristine output.

- [ ] **Step 7: Commit**

```bash
git add src/state/authStateMachine.ts tests/state/authStateMachine.test.ts src/persistence/repositories/authSessionRepository.ts
git commit -m "feat: auth session state machine with transition validation and audit logging"
```

---

### Task 3: Authenticated-dashboard detector

**Files:**
- Create: `src/browser/authDetector.ts`
- Test: `tests/browser/authDetector.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `function isAuthenticatedDashboard(pageText: string): boolean`. Plan 3's browser-controller code will call this with real page text extracted from the retained Playwright `Page`; this task tests it with plain string fixtures only.

Per the spec, all three indicators must be present: `Welcome : <email>`, `Logout`, `Bid Management`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/browser/authDetector.test.ts
import { describe, it, expect } from 'vitest';
import { isAuthenticatedDashboard } from '../../src/browser/authDetector.js';

describe('isAuthenticatedDashboard', () => {
  it('returns true when all three indicators are present', () => {
    const pageText = `
      Welcome : contractor@example.com
      Home | Bid Management | My Account | Logout
    `;
    expect(isAuthenticatedDashboard(pageText)).toBe(true);
  });

  it('returns false when Welcome is missing', () => {
    const pageText = 'Home | Bid Management | My Account | Logout';
    expect(isAuthenticatedDashboard(pageText)).toBe(false);
  });

  it('returns false when Logout is missing', () => {
    const pageText = 'Welcome : contractor@example.com\nHome | Bid Management | My Account';
    expect(isAuthenticatedDashboard(pageText)).toBe(false);
  });

  it('returns false when Bid Management is missing', () => {
    const pageText = 'Welcome : contractor@example.com\nHome | My Account | Logout';
    expect(isAuthenticatedDashboard(pageText)).toBe(false);
  });

  it('returns false for an empty page', () => {
    expect(isAuthenticatedDashboard('')).toBe(false);
  });

  it('returns false for the pre-login page (only a login form)', () => {
    const pageText = 'User Login\nUsername\nPassword\nLogin with DSC';
    expect(isAuthenticatedDashboard(pageText)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/browser/authDetector.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/browser/authDetector.ts
export function isAuthenticatedDashboard(pageText: string): boolean {
  const hasWelcome = /Welcome\s*:\s*\S+/.test(pageText);
  const hasLogout = pageText.includes('Logout');
  const hasBidManagement = pageText.includes('Bid Management');
  return hasWelcome && hasLogout && hasBidManagement;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/browser/authDetector.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/browser/authDetector.ts tests/browser/authDetector.test.ts
git commit -m "feat: authenticated-dashboard indicator detector"
```

---

### Task 4: Session-expired page detector

**Files:**
- Create: `src/browser/sessionExpiredDetector.ts`
- Test: `tests/browser/sessionExpiredDetector.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `function isSessionExpiredPage(url: string, pageText: string): boolean`. Same usage pattern as Task 3 — Plan 3 calls this with the real current URL and page text from the retained `Page`.

Per the spec: URL pattern containing `page=CommonErrorPage`, OR page text indicating the session expired. Either signal alone is sufficient (a false negative here — failing to detect expiry — is worse than a false positive, since a false positive just triggers an extra reauth prompt).

- [ ] **Step 1: Write the failing test**

```ts
// tests/browser/sessionExpiredDetector.test.ts
import { describe, it, expect } from 'vitest';
import { isSessionExpiredPage } from '../../src/browser/sessionExpiredDetector.js';

describe('isSessionExpiredPage', () => {
  it('returns true when the URL contains page=CommonErrorPage', () => {
    const url = 'https://tntenders.gov.in/nicgep/app?page=CommonErrorPage&service=direct';
    expect(isSessionExpiredPage(url, 'Some error occurred')).toBe(true);
  });

  it('returns true when the page text says the session expired, even with a normal URL', () => {
    const url = 'https://tntenders.gov.in/nicgep/app?page=WebTenderStatusLists';
    const text = 'Your session in the client area has expired. Please login again.';
    expect(isSessionExpiredPage(url, text)).toBe(true);
  });

  it('returns false for a normal authenticated page with no error indicators', () => {
    const url = 'https://tntenders.gov.in/nicgep/app?page=WebTenderStatusLists';
    const text = 'Welcome : contractor@example.com\nBid Management\nLogout';
    expect(isSessionExpiredPage(url, text)).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(isSessionExpiredPage('', '')).toBe(false);
  });

  it('is case-insensitive for the page text match', () => {
    const url = 'https://tntenders.gov.in/nicgep/app?page=WebTenderStatusLists';
    const text = 'YOUR SESSION IN THE CLIENT AREA HAS EXPIRED';
    expect(isSessionExpiredPage(url, text)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/browser/sessionExpiredDetector.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/browser/sessionExpiredDetector.ts
export function isSessionExpiredPage(url: string, pageText: string): boolean {
  const urlMatches = url.includes('page=CommonErrorPage');
  const textMatches = /session .{0,40}expired/i.test(pageText);
  return urlMatches || textMatches;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/browser/sessionExpiredDetector.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/browser/sessionExpiredDetector.ts tests/browser/sessionExpiredDetector.test.ts
git commit -m "feat: session-expired page detector"
```

---

### Task 5: Chrome path resolution and launch-argument builder

**Files:**
- Create: `src/browser/chromeLauncher.ts`
- Test: `tests/browser/chromeLauncher.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions; `resolveChromePath` takes injectable parameters).
- Produces: `interface ChromeLaunchOptions { userDataDir: string; cdpPort: number }`; `function resolveChromePath(candidates?: string[], exists?: (path: string) => boolean): string`; `function buildChromeLaunchArgs(options: ChromeLaunchOptions): string[]`. Plan 3's actual `launchChrome()` (which spawns a real child process — not covered by this plan, not unit-testable without a live process) will call both of these.

- [ ] **Step 1: Write the failing test**

```ts
// tests/browser/chromeLauncher.test.ts
import { describe, it, expect } from 'vitest';
import { resolveChromePath, buildChromeLaunchArgs } from '../../src/browser/chromeLauncher.js';

describe('resolveChromePath', () => {
  it('returns the first candidate path that exists', () => {
    const candidates = ['C:\\fake\\chrome.exe', 'C:\\real\\chrome.exe'];
    const exists = (path: string) => path === 'C:\\real\\chrome.exe';

    expect(resolveChromePath(candidates, exists)).toBe('C:\\real\\chrome.exe');
  });

  it('prefers the first matching candidate over a later one', () => {
    const candidates = ['C:\\first\\chrome.exe', 'C:\\second\\chrome.exe'];
    const exists = () => true;

    expect(resolveChromePath(candidates, exists)).toBe('C:\\first\\chrome.exe');
  });

  it('throws when no candidate exists', () => {
    const candidates = ['C:\\fake\\chrome.exe'];
    const exists = () => false;

    expect(() => resolveChromePath(candidates, exists)).toThrow(
      'Google Chrome not found in standard install locations'
    );
  });

  it('finds the real Chrome install on this machine using the default candidates', () => {
    expect(() => resolveChromePath()).not.toThrow();
    expect(resolveChromePath()).toContain('chrome.exe');
  });
});

describe('buildChromeLaunchArgs', () => {
  it('builds the expected CDP and profile arguments', () => {
    const args = buildChromeLaunchArgs({ userDataDir: 'C:\\Users\\test\\TenderAssist\\profile', cdpPort: 9222 });

    expect(args).toEqual([
      '--remote-debugging-port=9222',
      '--user-data-dir=C:\\Users\\test\\TenderAssist\\profile',
      '--no-first-run',
      '--no-default-browser-check',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/browser/chromeLauncher.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/browser/chromeLauncher.ts
import { existsSync } from 'node:fs';

export interface ChromeLaunchOptions {
  userDataDir: string;
  cdpPort: number;
}

const DEFAULT_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

export function resolveChromePath(
  candidates: string[] = DEFAULT_CHROME_PATHS,
  exists: (path: string) => boolean = existsSync
): string {
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  throw new Error('Google Chrome not found in standard install locations');
}

export function buildChromeLaunchArgs(options: ChromeLaunchOptions): string[] {
  return [
    `--remote-debugging-port=${options.cdpPort}`,
    `--user-data-dir=${options.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/browser/chromeLauncher.test.ts`
Expected: 5 passed. (Note: the 4th `resolveChromePath` test depends on real Chrome being installed at one of the default Windows paths — true on this machine, verified by the controller before this plan was written. If this test ever fails on a different machine, it is signal, not noise: TenderAssist requires a real Chrome install to function at all.)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass (46 from Tasks 1-2 + 6 + 5 + 5 = 62), typecheck clean on both configs.

- [ ] **Step 6: Commit**

```bash
git add src/browser/chromeLauncher.ts tests/browser/chromeLauncher.test.ts
git commit -m "feat: Chrome path resolution and launch-argument builder"
```

---

## Self-Review Notes

- **Spec coverage:** auth session state model (Tasks 1-2), auth dashboard indicator detection requiring all three indicators (Task 3, spec section 4), session-expired detection via URL pattern and page text (Task 4, spec section 5), Chrome launch prerequisites for the real-tab-retention strategy (Task 5, spec section C). Live CDP attach, tab retention, navigation, and the actual DSC login flow are deliberately deferred to Plan 3 — this plan only builds what's testable without a live browser.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code.
- **Type consistency:** `AuthState` defined once in Task 1, imported everywhere else. `AuthSessionRepository`'s method signatures in Task 1 match exactly what `AuthStateMachine` calls in Task 2 (`updateState(id, state)`, `markAuthenticatedAt(id, timestamp)`).

## Next Plan

Plan 3 (not yet written): live browser controller — real Chrome launch via `launchChrome()` (thin wrapper around Task 5's `resolveChromePath`/`buildChromeLaunchArgs` plus `child_process.spawn`), Playwright `connectOverCDP`, single-Page retention by `targetId`, tab-loss event wiring (`page.on('close')`, CDP `Target.targetDestroyed`, navigation matching Task 4's `isSessionExpiredPage`), and finally a manual acceptance step against the real TN Tenders portal with human DSC login — this last step cannot be automated and needs the user's direct participation.
