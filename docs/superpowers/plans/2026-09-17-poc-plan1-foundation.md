# Foundation: Scaffolding + Persistence + Job State Machine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the TenderAssist Node/TypeScript project skeleton with a SQLite persistence layer and a fully validated Job state machine, so later plans (browser controller, search, classification, acquisition) have a durable, tested foundation to build on.

**Architecture:** Pure Node.js + TypeScript, no Electron/browser dependency yet (deferred to the UI-integration phase). SQLite via Node's built-in `node:sqlite` (`DatabaseSync`, WAL mode) with a file-based migration runner — no native module, no C++ toolchain required. Every entity state transition is written in the same DB transaction as an append-only audit row in `state_transitions`, so resume logic never has to re-derive state from ambiguous data.

**Tech Stack:** TypeScript (strict, NodeNext modules), node:sqlite, Vitest.

**Revision note (2026-09-17):** this plan originally specified `better-sqlite3`. Task 1's implementer hit a real build failure — no prebuilt binary for this Node version, and node-gyp requires Visual Studio Build Tools that aren't installed. Since the product must never require a customer's machine to have a C++ toolchain either, every task below now uses `node:sqlite`'s `DatabaseSync` instead. See the spec's Persistence section for the exact API differences (no `.pragma()`, no `.transaction()` helper, null-prototype rows).

**Spec:** `docs/superpowers/specs/2026-09-17-tenderassist-architecture.md`

## Global Constraints

- No Electron, Playwright, or any browser dependency in this plan — those belong to Plan 2 onward.
- No native (node-gyp/C++-compiled) npm dependency anywhere in this plan — use `node:sqlite`, not `better-sqlite3`. The product must run on a customer's machine with no C++ toolchain installed.
- `node:sqlite`'s official types (`@types/node`) type `StatementSync.run()`'s named-parameter overload as `Record<string, SQLInputValue>` (requires an index signature) and `.get()`/`.all()` always return `Record<string, SQLOutputValue>` / `Record<string, SQLOutputValue>[]` (never generic/parameterizable). Consequences for every repository in this plan and future ones: (1) pass parameters positionally (`?` placeholders, `.run(a, b, c)`) rather than as a named object (`@x` placeholders, `.run(row)`) — a plain domain interface like `JobRow` has no index signature and fails the `Record<string, SQLInputValue>` overload; (2) cast array results through `unknown` first — `.all(...) as unknown as MyRow[]` — single-object `.get(...)` results and `undefined`-unioned casts do not need the `unknown` step (verified: `as MyRow | undefined` alone compiles), but array casts do. `npm run typecheck` (`tsc --noEmit`) must be clean — `npm test` alone does not catch these, since Vitest's esbuild transform strips types without checking them.
- Every table/entity mutation must go through a repository method; no ad hoc SQL outside `src/persistence/`.
- Every state transition must be recorded in `state_transitions` in the same transaction as the state update — never a bare `UPDATE` without an audit row.
- No credentials/secrets exist yet in this plan, but the logger built here (Task 3) must redact any field whose key matches a secret-like name, since later plans will log through it.
- TypeScript strict mode; no `any` in production code (test files may use `any` sparingly for row casting).

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working `npm test` command any later task can run; `src/` and `tests/` directory convention (`tests/<mirror-of-src-path>.test.ts`).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "tenderassist",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^26.0.0",
    "typescript": "^5.7.2",
    "vitest": "^5.0.1",
    "vite": "^8.3.0"
  }
}
```

No `dependencies` block: `node:sqlite` is built into Node itself (verified working on this machine's Node version with no native compile step), so the persistence layer needs zero external package.

**Revision note (2026-09-17):** `vitest`/`vite` versions above were corrected from the original `"vitest": "^2.1.8"` (no `vite` entry) after Task 4 hit a real bug: that Vite version's builtin-module allowlist predates `node:sqlite` (added in Node 22.5+), so a plain `import { DatabaseSync } from 'node:sqlite'` fails to resolve under it — it's treated as a bare npm package, not a Node builtin, producing `Failed to load url sqlite (resolved id: sqlite)`. `vitest@5.0.1` + `vite@8.3.0` (a required peer pair) resolves this natively, no workaround needed. **Any future plan scaffolding a new TypeScript/Vitest project in this codebase must start from these versions, not `^2.1.8`** — the old version is a known trap for anything importing `node:sqlite`.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
*.db
*.db-journal
*.db-wal
*.db-shm
.env
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, `package-lock.json` created, no errors.

- [ ] **Step 6: Write and run a smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('toolchain smoke test', () => {
  it('runs TypeScript tests via vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: 1 passed test.

- [ ] **Step 7: Initialize git and commit**

```bash
git init
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore tests/smoke.test.ts
git commit -m "chore: project scaffolding (TypeScript + Vitest + better-sqlite3)"
```

---

### Task 2: Config paths module

**Files:**
- Create: `src/config/paths.ts`
- Test: `tests/config/paths.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getAppDataDir(env?): string`, `getDatabasePath(env?): string` — used by Task 4's `db.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/config/paths.test.ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { getAppDataDir, getDatabasePath } from '../../src/config/paths.js';

describe('paths', () => {
  it('uses APPDATA when set', () => {
    const dir = getAppDataDir({ APPDATA: 'C:\\Users\\Admin\\AppData\\Roaming' } as NodeJS.ProcessEnv);
    expect(dir).toBe(join('C:\\Users\\Admin\\AppData\\Roaming', 'TenderAssist'));
  });

  it('falls back to a home config dir when APPDATA is unset', () => {
    const dir = getAppDataDir({} as NodeJS.ProcessEnv);
    expect(dir.endsWith(join('.config', 'TenderAssist'))).toBe(true);
  });

  it('appends the database filename to the app data dir', () => {
    const dbPath = getDatabasePath({ APPDATA: 'C:\\AppData' } as NodeJS.ProcessEnv);
    expect(dbPath).toBe(join('C:\\AppData', 'TenderAssist', 'tenderassist.db'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/config/paths.test.ts`
Expected: FAIL — cannot find module `../../src/config/paths.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config/paths.ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export function getAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.APPDATA ?? join(homedir(), '.config');
  return join(base, 'TenderAssist');
}

export function getDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getAppDataDir(env), 'tenderassist.db');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/config/paths.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/config/paths.ts tests/config/paths.test.ts
git commit -m "feat: app data / database path resolution"
```

---

### Task 3: Structured logger with secret redaction

**Files:**
- Create: `src/observability/logger.ts`
- Test: `tests/observability/logger.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `logger.debug/info/warn/error(message: string, fields?: LogFields): void`, exported `LogFields = Record<string, unknown>`. Every later task that logs anything imports `logger` from this module — no `console.log` elsewhere in `src/`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/observability/logger.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from '../../src/observability/logger.js';

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits structured JSON with level, message, and fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('job started', { jobId: 'abc-123' });

    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('job started');
    expect(entry.jobId).toBe('abc-123');
    expect(typeof entry.timestamp).toBe('string');
  });

  it('redacts fields whose key looks like a secret', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.warn('dsc pin entered', { dscPin: '1234', tenderId: 'EB_704783' });

    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry.dscPin).toBe('[REDACTED]');
    expect(entry.tenderId).toBe('EB_704783');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/observability/logger.test.ts`
Expected: FAIL — cannot find module `../../src/observability/logger.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/observability/logger.ts
const SECRET_KEY_FRAGMENTS = ['password', 'pin', 'token', 'secret', 'credential', 'privatekey'];

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    const isSecret = SECRET_KEY_FRAGMENTS.some((fragment) => key.toLowerCase().includes(fragment));
    out[key] = isSecret ? '[REDACTED]' : value;
  }
  return out;
}

function write(level: LogLevel, message: string, fields: LogFields): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redact(fields),
  };
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (message: string, fields: LogFields = {}) => write('debug', message, fields),
  info: (message: string, fields: LogFields = {}) => write('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => write('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => write('error', message, fields),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/observability/logger.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/observability/logger.ts tests/observability/logger.test.ts
git commit -m "feat: structured logger with secret-field redaction"
```

---

### Task 4: SQLite connection + migration runner + initial schema

**Files:**
- Create: `src/persistence/db.ts`
- Create: `src/persistence/migrate.ts`
- Create: `src/persistence/migrations/001_init.sql`
- Test: `tests/persistence/migrate.test.ts`

**Interfaces:**
- Consumes: nothing (uses Node's built-in `node:sqlite` directly — no external package).
- Produces: `createDatabase(path: string): DatabaseSync`, `runMigrations(db: DatabaseSync, migrationsDir: string): void`, `withTransaction(db: DatabaseSync, fn: () => void): void`. After migration, tables `jobs` and `state_transitions` exist. Later tasks (5, 6, 7) depend on these exact table/column names and on `withTransaction` for atomic multi-statement writes (node:sqlite's `DatabaseSync` has no built-in `.transaction()` helper, unlike better-sqlite3).

- [ ] **Step 1: Write the failing test**

```ts
// tests/persistence/migrate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';

describe('runMigrations', () => {
  let db: DatabaseSync;
  let migrationsDir: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrationsDir = mkdtempSync(join(tmpdir(), 'tenderassist-migrations-'));
    writeFileSync(
      join(migrationsDir, '001_test.sql'),
      'CREATE TABLE widgets (id TEXT PRIMARY KEY);'
    );
  });

  it('applies pending migrations', () => {
    runMigrations(db, migrationsDir);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'widgets'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it('does not re-apply an already-applied migration', () => {
    runMigrations(db, migrationsDir);
    db.prepare('INSERT INTO widgets (id) VALUES (?)').run('one');
    runMigrations(db, migrationsDir);
    const rows = db.prepare('SELECT * FROM widgets').all();
    expect(rows).toHaveLength(1);
  });

  it('applies the real 001_init migration creating jobs and state_transitions', () => {
    const realDb = new DatabaseSync(':memory:');
    runMigrations(realDb, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const names = realDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row: any) => row.name);
    expect(names).toEqual(expect.arrayContaining(['jobs', 'state_transitions']));
    realDb.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/persistence/migrate.test.ts`
Expected: FAIL — cannot find module `../../src/persistence/migrate.js`.

- [ ] **Step 3: Write `src/persistence/db.ts`**

```ts
// src/persistence/db.ts
import { DatabaseSync } from 'node:sqlite';

export function createDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function withTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
```

- [ ] **Step 4: Write `src/persistence/migrate.ts`**

```ts
// src/persistence/migrate.ts
import type { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withTransaction } from './db.js';

export function runMigrations(db: DatabaseSync, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>).map(
      (row) => row.id
    )
  );

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)'
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    withTransaction(db, () => {
      db.exec(sql);
      insertMigration.run(file, new Date().toISOString());
    });
  }
}
```

- [ ] **Step 5: Write `src/persistence/migrations/001_init.sql`**

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE state_transitions (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT,
  occurred_at TEXT NOT NULL
);

CREATE INDEX idx_state_transitions_entity ON state_transitions (entity_type, entity_id);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/persistence/migrate.test.ts`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add src/persistence/db.ts src/persistence/migrate.ts src/persistence/migrations/001_init.sql tests/persistence/migrate.test.ts
git commit -m "feat: SQLite connection and file-based migration runner"
```

---

### Task 5: StateTransitionRepository

**Files:**
- Create: `src/persistence/repositories/stateTransitionRepository.ts`
- Test: `tests/persistence/repositories/stateTransitionRepository.test.ts`

**Interfaces:**
- Consumes: `createDatabase`/`runMigrations` from Task 4 (test setup only), `state_transitions` table schema from `001_init.sql`.
- Produces: `class StateTransitionRepository { record(entityType: string, entityId: string, fromState: string | null, toState: string, reason?: string): void; listFor(entityType: string, entityId: string): StateTransitionRow[] }` and `interface StateTransitionRow { id: string; entity_type: string; entity_id: string; from_state: string | null; to_state: string; reason: string | null; occurred_at: string }`. Task 7's `JobStateMachine` depends on `record()`'s exact signature.

- [ ] **Step 1: Write the failing test**

```ts
// tests/persistence/repositories/stateTransitionRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { StateTransitionRepository } from '../../../src/persistence/repositories/stateTransitionRepository.js';

describe('StateTransitionRepository', () => {
  let db: DatabaseSync;
  let repo: StateTransitionRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new StateTransitionRepository(db);
  });

  it('records a transition and lists it back in order', () => {
    repo.record('JOB', 'job-1', null, 'SCHEDULED', 'created');
    repo.record('JOB', 'job-1', 'SCHEDULED', 'AUTH_REQUIRED');

    const rows = repo.listFor('JOB', 'job-1');
    expect(rows).toHaveLength(2);
    expect(rows[0].from_state).toBeNull();
    expect(rows[0].to_state).toBe('SCHEDULED');
    expect(rows[1].from_state).toBe('SCHEDULED');
    expect(rows[1].to_state).toBe('AUTH_REQUIRED');
  });

  it('scopes listFor to the given entity', () => {
    repo.record('JOB', 'job-1', null, 'SCHEDULED');
    repo.record('JOB', 'job-2', null, 'SCHEDULED');

    expect(repo.listFor('JOB', 'job-1')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/persistence/repositories/stateTransitionRepository.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/persistence/repositories/stateTransitionRepository.ts
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface StateTransitionRow {
  id: string;
  entity_type: string;
  entity_id: string;
  from_state: string | null;
  to_state: string;
  reason: string | null;
  occurred_at: string;
}

export class StateTransitionRepository {
  constructor(private db: DatabaseSync) {}

  record(
    entityType: string,
    entityId: string,
    fromState: string | null,
    toState: string,
    reason?: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO state_transitions (id, entity_type, entity_id, from_state, to_state, reason, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), entityType, entityId, fromState, toState, reason ?? null, new Date().toISOString());
  }

  listFor(entityType: string, entityId: string): StateTransitionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM state_transitions WHERE entity_type = ? AND entity_id = ? ORDER BY occurred_at ASC`
      )
      .all(entityType, entityId) as unknown as StateTransitionRow[];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/persistence/repositories/stateTransitionRepository.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/repositories/stateTransitionRepository.ts tests/persistence/repositories/stateTransitionRepository.test.ts
git commit -m "feat: state transition audit repository"
```

---

### Task 6: JobRepository

**Revision note (2026-09-17):** `findIncomplete()`'s query below was corrected during execution from `ORDER BY created_at DESC LIMIT 1` to `ORDER BY created_at DESC, rowid DESC LIMIT 1`. Verified empirically (500-run reproduction against real `node:sqlite`) that the original query fails this task's own `findIncomplete` test ~96% of the time — `new Date().toISOString()` has 1ms resolution and the test's two synchronous `create()` calls routinely tie on `created_at`, and SQLite does not break ties deterministically in the caller's favor. The `rowid DESC` tiebreaker fixes this (verified 0/500 failures) while preserving "most recently *created*" semantics — it does not change the primary sort key to `updated_at`, which would silently redefine what `findIncomplete()` selects.

**Files:**
- Create: `src/persistence/repositories/jobRepository.ts`
- Test: `tests/persistence/repositories/jobRepository.test.ts`

**Interfaces:**
- Consumes: `jobs` table schema from Task 4.
- Produces: `type JobState = 'SCHEDULED' | 'AUTH_REQUIRED' | 'AUTH_PENDING' | 'AUTHENTICATED' | 'SEARCHING' | 'CLASSIFYING' | 'SHORTLISTED' | 'ACQUIRING_DOCUMENTS' | 'SESSION_EXPIRED' | 'DOCUMENTS_LOCAL' | 'PROCESSING_DOCUMENTS' | 'EXTRACTING_REQUIREMENTS' | 'UPLOADING' | 'REPORTING' | 'COMPLETE' | 'FAILED_RETRYABLE' | 'FAILED_MANUAL'`; `interface JobRow { id: string; state: JobState; created_at: string; updated_at: string }`; `class JobRepository { create(): JobRow; getById(id: string): JobRow | undefined; updateState(id: string, state: JobState): void; findIncomplete(): JobRow | undefined }`. Task 7's `JobStateMachine` depends on this exact `JobRepository` shape and on `JobState`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/persistence/repositories/jobRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';

describe('JobRepository', () => {
  let db: DatabaseSync;
  let repo: JobRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new JobRepository(db);
  });

  it('creates a job in SCHEDULED state and reads it back', () => {
    const created = repo.create();
    expect(created.state).toBe('SCHEDULED');

    const fetched = repo.getById(created.id);
    expect(fetched).toEqual(created);
  });

  it('returns undefined for an unknown id', () => {
    expect(repo.getById('does-not-exist')).toBeUndefined();
  });

  it('updates state and bumps updated_at', async () => {
    const job = repo.create();
    await new Promise((resolve) => setTimeout(resolve, 5));
    repo.updateState(job.id, 'AUTH_REQUIRED');

    const fetched = repo.getById(job.id)!;
    expect(fetched.state).toBe('AUTH_REQUIRED');
    expect(fetched.updated_at).not.toBe(job.updated_at);
  });

  it('findIncomplete returns the most recent non-terminal job', () => {
    repo.create();
    const second = repo.create();
    repo.updateState(second.id, 'AUTH_REQUIRED');

    const incomplete = repo.findIncomplete();
    expect(incomplete?.id).toBe(second.id);
  });

  it('findIncomplete returns undefined when every job is terminal', () => {
    const job = repo.create();
    repo.updateState(job.id, 'FAILED_MANUAL');

    expect(repo.findIncomplete()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/persistence/repositories/jobRepository.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/persistence/repositories/jobRepository.ts
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type JobState =
  | 'SCHEDULED'
  | 'AUTH_REQUIRED'
  | 'AUTH_PENDING'
  | 'AUTHENTICATED'
  | 'SEARCHING'
  | 'CLASSIFYING'
  | 'SHORTLISTED'
  | 'ACQUIRING_DOCUMENTS'
  | 'SESSION_EXPIRED'
  | 'DOCUMENTS_LOCAL'
  | 'PROCESSING_DOCUMENTS'
  | 'EXTRACTING_REQUIREMENTS'
  | 'UPLOADING'
  | 'REPORTING'
  | 'COMPLETE'
  | 'FAILED_RETRYABLE'
  | 'FAILED_MANUAL';

export interface JobRow {
  id: string;
  state: JobState;
  created_at: string;
  updated_at: string;
}

const TERMINAL_STATES: JobState[] = ['COMPLETE', 'FAILED_MANUAL'];

export class JobRepository {
  constructor(private db: DatabaseSync) {}

  create(): JobRow {
    const now = new Date().toISOString();
    const row: JobRow = { id: randomUUID(), state: 'SCHEDULED', created_at: now, updated_at: now };
    this.db
      .prepare('INSERT INTO jobs (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(row.id, row.state, row.created_at, row.updated_at);
    return row;
  }

  getById(id: string): JobRow | undefined {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  }

  updateState(id: string, state: JobState): void {
    this.db
      .prepare('UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, new Date().toISOString(), id);
  }

  findIncomplete(): JobRow | undefined {
    const placeholders = TERMINAL_STATES.map(() => '?').join(', ');
    return this.db
      .prepare(
        `SELECT * FROM jobs WHERE state NOT IN (${placeholders}) ORDER BY created_at DESC, rowid DESC LIMIT 1`
      )
      .get(...TERMINAL_STATES) as JobRow | undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/persistence/repositories/jobRepository.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/repositories/jobRepository.ts tests/persistence/repositories/jobRepository.test.ts
git commit -m "feat: job repository (create/read/update/find-incomplete)"
```

---

### Task 7: JobStateMachine

**Files:**
- Create: `src/state/jobStateMachine.ts`
- Test: `tests/state/jobStateMachine.test.ts`

**Interfaces:**
- Consumes: `JobRepository`/`JobRow`/`JobState` from Task 6, `StateTransitionRepository` from Task 5, `withTransaction` from Task 4's `src/persistence/db.ts`.
- Produces: `class IllegalJobTransitionError extends Error`; `class JobStateMachine { constructor(db: DatabaseSync, jobs: JobRepository, transitions: StateTransitionRepository); transition(jobId: string, to: JobState, reason?: string): void }`. This is the module later plans (browser controller, acquisition loop) call to move a job between states — no later task should call `JobRepository.updateState` directly.

- [ ] **Step 1: Write the failing test**

```ts
// tests/state/jobStateMachine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { JobStateMachine, IllegalJobTransitionError } from '../../src/state/jobStateMachine.js';

describe('JobStateMachine', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let transitions: StateTransitionRepository;
  let machine: JobStateMachine;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    transitions = new StateTransitionRepository(db);
    machine = new JobStateMachine(db, jobs, transitions);
  });

  it('allows a valid transition and records it in the audit log', () => {
    const job = jobs.create();
    machine.transition(job.id, 'AUTH_REQUIRED', 'scheduler fired');

    expect(jobs.getById(job.id)?.state).toBe('AUTH_REQUIRED');
    const log = transitions.listFor('JOB', job.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ from_state: 'SCHEDULED', to_state: 'AUTH_REQUIRED', reason: 'scheduler fired' });
  });

  it('rejects an invalid transition and leaves state unchanged', () => {
    const job = jobs.create();
    expect(() => machine.transition(job.id, 'COMPLETE')).toThrow(IllegalJobTransitionError);
    expect(jobs.getById(job.id)?.state).toBe('SCHEDULED');
    expect(transitions.listFor('JOB', job.id)).toHaveLength(0);
  });

  it('throws for an unknown job id', () => {
    expect(() => machine.transition('missing-job', 'AUTH_REQUIRED')).toThrow('Job not found: missing-job');
  });

  it('allows the full acquisition happy path in sequence', () => {
    const job = jobs.create();
    const path: Array<[string, string?]> = [
      ['AUTH_REQUIRED'],
      ['AUTH_PENDING'],
      ['AUTHENTICATED'],
      ['SEARCHING'],
      ['CLASSIFYING'],
      ['SHORTLISTED'],
      ['ACQUIRING_DOCUMENTS'],
      ['DOCUMENTS_LOCAL'],
      ['PROCESSING_DOCUMENTS'],
      ['EXTRACTING_REQUIREMENTS'],
      ['UPLOADING'],
      ['REPORTING'],
      ['COMPLETE'],
    ];
    for (const [to] of path) {
      expect(() => machine.transition(job.id, to as any)).not.toThrow();
    }
    expect(jobs.getById(job.id)?.state).toBe('COMPLETE');
  });

  it('allows SESSION_EXPIRED to loop back to AUTH_REQUIRED', () => {
    const job = jobs.create();
    machine.transition(job.id, 'AUTH_REQUIRED');
    machine.transition(job.id, 'AUTH_PENDING');
    machine.transition(job.id, 'AUTHENTICATED');
    machine.transition(job.id, 'SEARCHING');
    machine.transition(job.id, 'CLASSIFYING');
    machine.transition(job.id, 'SHORTLISTED');
    machine.transition(job.id, 'ACQUIRING_DOCUMENTS');
    machine.transition(job.id, 'SESSION_EXPIRED');
    machine.transition(job.id, 'AUTH_REQUIRED');

    expect(jobs.getById(job.id)?.state).toBe('AUTH_REQUIRED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/state/jobStateMachine.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/state/jobStateMachine.ts
import type { DatabaseSync } from 'node:sqlite';
import type { JobRepository, JobState } from '../persistence/repositories/jobRepository.js';
import type { StateTransitionRepository } from '../persistence/repositories/stateTransitionRepository.js';
import { withTransaction } from '../persistence/db.js';

const VALID_TRANSITIONS: Record<JobState, JobState[]> = {
  SCHEDULED: ['AUTH_REQUIRED', 'FAILED_MANUAL'],
  AUTH_REQUIRED: ['AUTH_PENDING', 'FAILED_MANUAL'],
  AUTH_PENDING: ['AUTHENTICATED', 'AUTH_REQUIRED', 'FAILED_MANUAL'],
  AUTHENTICATED: ['SEARCHING', 'SESSION_EXPIRED', 'AUTH_REQUIRED', 'FAILED_MANUAL'],
  SEARCHING: ['CLASSIFYING', 'SESSION_EXPIRED', 'AUTH_REQUIRED', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  CLASSIFYING: ['SHORTLISTED', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  SHORTLISTED: ['ACQUIRING_DOCUMENTS', 'FAILED_MANUAL'],
  ACQUIRING_DOCUMENTS: [
    'DOCUMENTS_LOCAL',
    'SESSION_EXPIRED',
    'AUTH_REQUIRED',
    'FAILED_RETRYABLE',
    'FAILED_MANUAL',
  ],
  SESSION_EXPIRED: ['AUTH_REQUIRED', 'FAILED_MANUAL'],
  DOCUMENTS_LOCAL: ['PROCESSING_DOCUMENTS', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  PROCESSING_DOCUMENTS: ['EXTRACTING_REQUIREMENTS', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  EXTRACTING_REQUIREMENTS: ['UPLOADING', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  UPLOADING: ['REPORTING', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  REPORTING: ['COMPLETE', 'FAILED_RETRYABLE', 'FAILED_MANUAL'],
  COMPLETE: [],
  FAILED_RETRYABLE: ['AUTH_REQUIRED', 'SEARCHING', 'ACQUIRING_DOCUMENTS', 'FAILED_MANUAL'],
  FAILED_MANUAL: [],
};

export class IllegalJobTransitionError extends Error {
  constructor(from: JobState, to: JobState) {
    super(`Illegal job state transition: ${from} -> ${to}`);
    this.name = 'IllegalJobTransitionError';
  }
}

export class JobStateMachine {
  constructor(
    private db: DatabaseSync,
    private jobs: JobRepository,
    private transitions: StateTransitionRepository
  ) {}

  transition(jobId: string, to: JobState, reason?: string): void {
    const job = this.jobs.getById(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const allowed = VALID_TRANSITIONS[job.state] ?? [];
    if (!allowed.includes(to)) {
      throw new IllegalJobTransitionError(job.state, to);
    }

    withTransaction(this.db, () => {
      this.jobs.updateState(jobId, to);
      this.transitions.record('JOB', jobId, job.state, to, reason);
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/state/jobStateMachine.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests across all tasks pass (smoke + paths + logger + migrate + stateTransitionRepository + jobRepository + jobStateMachine).

- [ ] **Step 6: Commit**

```bash
git add src/state/jobStateMachine.ts tests/state/jobStateMachine.test.ts
git commit -m "feat: job state machine with transition validation and audit logging"
```

---

## Self-Review Notes

- **Spec coverage:** Tech stack choices (Task 1), state model for Job (Tasks 6–7), persistence-first approach and audit trail (Tasks 4–5, spec's "Persistence/resume strategy" and "Audit trail" sections) are all covered. Auth session, search, tender, document, and download-expectation tables/repositories are intentionally deferred to Plan 2+ per the spec's phase plan — they aren't needed until the browser controller exists, and building them now would be speculative ahead of need.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code.
- **Type consistency:** `JobState` is defined once in Task 6 and imported (not redefined) everywhere else; `StateTransitionRepository.record` signature in Task 5 matches its call site in Task 7's `JobStateMachine.transition`.

## Next Plan

Plan 2 (not yet written): Browser controller + auth session repository + DOM-indicator auth detection against a real Chrome instance, per Phase 1 in the spec. Write it after this plan is fully executed and the toolchain is proven.
