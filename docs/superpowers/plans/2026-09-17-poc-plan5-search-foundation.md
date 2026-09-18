# Search Foundation: Config, Persistence, Result Parsing, Gates 1-2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fully unit-testable foundation for Phase 3 (TN Tenders search execution) — the 7 configured searches as data, `searches`/`tenders` persistence, a pure result-row parser, a portal date parser, and the two deterministic classification gates (G1 freshness, G2 product category match). This plan deliberately excludes driving the real browser through the search form (that's Plan 6) — every task here is testable with real, already-captured portal data as fixtures, no live browser session required.

**Architecture:** Same conventions as Plans 1-4: `node:sqlite`, repositories own all SQL, positional params, `unknown`-first array casts. The parser (`tenderRowParser.ts`) is a pure function taking an array of already-extracted table-cell strings — it does not know how those cells were extracted from the DOM (that's Plan 6's job, which will call Playwright to pull `<td>` text content into an array and hand it to this function). This mirrors the Plan 2/Plan 3 split (pure detectors vs. the browser code that feeds them).

**Tech Stack:** TypeScript (strict, NodeNext modules), `node:sqlite`, Vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-17-tenderassist-architecture.md` — Gates 1/2 (deterministic), search model, tender classification audit fields.

**Depends on:** Plans 1-4 (all complete). Imports `createDatabase`/`runMigrations`/`withTransaction` (Plan 1), `JobRepository` (Plan 1, test setup).

## Verified against the real portal (2026-09-17, controller + user jointly, live session)

These are not assumptions — they were captured from a real, CAPTCHA-solved search against `https://tntenders.gov.in/nicgep/app`'s Advanced Tender Search page, Product Category = "Computer- S/W":

- **The "Product Category" dropdown has exactly 99 values**, and the 7 values matching the spec's "5 categories → 7 searches" model are: `Computer- H/W`, `Computer- S/W`, `Information Technology`, `Info. Tech. Services`, `Miscellaneous Goods`, `Miscellaneous Services`, `Miscellaneous Works` (Miscellaneous split three ways, exactly as the spec described). This is a *different* field from "Tender Category" (Goods/Services/Works, 3 values) — the two are independent filters, and the Miscellaneous split is already baked into the Product Category values themselves, so no combination with Tender Category is needed for the 7 configured searches.
- **Every search (even the plain "Active Tenders" browse) requires solving a CAPTCHA.** Per the user's own real-world experience, this goes away once authenticated — not yet independently verified in a live authenticated session, so Plan 6 must confirm this on its first real search rather than assume it.
- **Search results table** columns, in order: `S.No | e-Published Date | Closing Date | Opening Date | Title and Ref.No./Tender ID | Organisation Chain`. Real captured row (verbatim):
  ```
  1. 11-Sep-2026 06:00 PM 28-Sep-2026 11:00 AM 29-Sep-2026 11:00 AM [Purchase of MATLAB with Simulink and Automotive related Tool Boxes for Establishment of Electric Vehicle Technology Laboratory in 3 Government Engineering Colleges at Tirunelveli, Dharmapuri and Erode] [GCE/TLY/5184/A2/2026][2026_DoTE_704004_1] Directorate of Technical Education||Govt. Engineering College - DOTE||Government College of Engineering - Tirunelveli
  ```
  The "Title and Ref.No./Tender ID" cell is always `[Title] [RefNo][TenderPortalId]` — one space after the title's closing bracket, zero spaces between the ref-number and tender-portal-id brackets. Organisation Chain is `||`-separated, most-general to most-specific. Dates are `DD-MMM-YYYY HH:MM AM/PM`, e.g. `11-Sep-2026 06:00 PM`. Two more real rows were captured and are used as test fixtures below.
- **A tender's own detail page** shows a top-level "Tender Category" field (Goods/Services/Works — tender-level metadata) and, separately, a **"Product Category" field inside each Work Item's own details section** (e.g. `Computer- S/W`) — this is the authoritative field Gate 2 must compare against, confirmed present with that exact label.
- **The detail page's "Critical Dates" section has a field literally labeled "Published Date"** — the source field for Gate 1.
- **The detail page's "Tenders Documents" section** confirmed the spec's exact predicted structure: an NIT Document table (real captured example filename: `Tendernotice_1.pdf`, matching the spec's stated generic-filename risk), a separate "Download as zip file" link, and a Work Item Documents table (real captured example: a `BOQ` document type, filename `BOQ_845450.xls`) — confirming both the NIT-vs-ZIP acquisition-path split and the BOQ-as-spreadsheet assumption from the spec.

## Global Constraints

- No live browser code in this plan — every test uses real, already-captured fixture data (verbatim from the section above), not a live portal connection. `it.skipIf`/`describe.skipIf` real-Chrome guards from Plans 2-4 do not apply here; this plan's suite must be fully deterministic and CI-safe.
- `node:sqlite` typing pattern from Plans 1-4 applies: positional `.run()` params, `unknown`-first `.all()` casts.
- Dates are stored as ISO 8601 strings with an explicit `+05:30` (IST) offset, never relying on the machine's local timezone — the portal displays times in IST regardless of where TenderAssist runs.
- `parseTenderRow`/`parseTenderPortalDate` must return `null` (never throw) on malformed input — a single unparseable row must not crash an entire search's result processing; the caller (Plan 6) decides how to handle a `null` (e.g. log and skip).
- TypeScript strict mode; no `any`. `npm run typecheck` must stay clean on both configs.

---

### Task 1: Search configuration + `searches` persistence

**Files:**
- Create: `src/persistence/migrations/003_searches.sql`
- Create: `src/search/searchConfig.ts`
- Create: `src/persistence/repositories/searchRepository.ts`
- Test: `tests/persistence/repositories/searchRepository.test.ts`

**Interfaces:**
- Consumes: `createDatabase`/`runMigrations`/`JobRepository` (Plan 1, test setup).
- Produces: `interface ConfiguredSearch { searchKey: string; productCategory: string }`; `const CONFIGURED_SEARCHES: ConfiguredSearch[]` (the 7 real values above); `type SearchState = 'PENDING' | 'RUNNING' | 'PAGINATING' | 'COMPLETE' | 'INTERRUPTED'`; `interface SearchRow { id, job_id, search_key, product_category, state, current_page, result_count, created_at, updated_at }`; `class SearchRepository { create(jobId, searchKey, productCategory): SearchRow; getById(id): SearchRow | undefined; findByJobAndKey(jobId, searchKey): SearchRow | undefined; listForJob(jobId): SearchRow[]; updateState(id, state): void; updateProgress(id, currentPage, resultCount): void; findFirstIncomplete(jobId): SearchRow | undefined }`. Plan 6 depends on this exact shape.

- [ ] **Step 1: Write the failing test**

```ts
// tests/persistence/repositories/searchRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';
import { SearchRepository } from '../../../src/persistence/repositories/searchRepository.js';
import { CONFIGURED_SEARCHES } from '../../../src/search/searchConfig.js';

describe('CONFIGURED_SEARCHES', () => {
  it('has exactly 7 configured searches matching the real portal Product Category values', () => {
    expect(CONFIGURED_SEARCHES).toHaveLength(7);
    expect(CONFIGURED_SEARCHES.map((s) => s.productCategory)).toEqual([
      'Computer- H/W',
      'Computer- S/W',
      'Information Technology',
      'Info. Tech. Services',
      'Miscellaneous Goods',
      'Miscellaneous Services',
      'Miscellaneous Works',
    ]);
    expect(CONFIGURED_SEARCHES.map((s) => s.searchKey)).toEqual([
      'search_1',
      'search_2',
      'search_3',
      'search_4',
      'search_5',
      'search_6',
      'search_7',
    ]);
  });
});

describe('SearchRepository', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let repo: SearchRepository;
  let jobId: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    repo = new SearchRepository(db);
    jobId = jobs.create().id;
  });

  it('creates a search in PENDING state', () => {
    const search = repo.create(jobId, 'search_1', 'Computer- H/W');
    expect(search.state).toBe('PENDING');
    expect(search.current_page).toBe(0);
    expect(search.result_count).toBeNull();
  });

  it('findByJobAndKey returns the matching row', () => {
    repo.create(jobId, 'search_1', 'Computer- H/W');
    const found = repo.findByJobAndKey(jobId, 'search_1');
    expect(found?.product_category).toBe('Computer- H/W');
  });

  it('listForJob returns all searches for the job, ordered by search_key', () => {
    repo.create(jobId, 'search_3', 'Information Technology');
    repo.create(jobId, 'search_1', 'Computer- H/W');
    const list = repo.listForJob(jobId);
    expect(list.map((s) => s.search_key)).toEqual(['search_1', 'search_3']);
  });

  it('updateState and updateProgress persist changes', () => {
    const search = repo.create(jobId, 'search_1', 'Computer- H/W');
    repo.updateState(search.id, 'RUNNING');
    repo.updateProgress(search.id, 2, 15);

    const fetched = repo.getById(search.id)!;
    expect(fetched.state).toBe('RUNNING');
    expect(fetched.current_page).toBe(2);
    expect(fetched.result_count).toBe(15);
  });

  it('findFirstIncomplete returns the first non-COMPLETE search in search_key order', () => {
    const s1 = repo.create(jobId, 'search_1', 'Computer- H/W');
    const s2 = repo.create(jobId, 'search_2', 'Computer- S/W');
    repo.updateState(s1.id, 'COMPLETE');

    const incomplete = repo.findFirstIncomplete(jobId);
    expect(incomplete?.id).toBe(s2.id);
  });

  it('findFirstIncomplete returns undefined when every search is COMPLETE', () => {
    const s1 = repo.create(jobId, 'search_1', 'Computer- H/W');
    repo.updateState(s1.id, 'COMPLETE');

    expect(repo.findFirstIncomplete(jobId)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/persistence/repositories/searchRepository.test.ts`
Expected: FAIL — cannot find modules `searchConfig.js`/`searchRepository.js`.

- [ ] **Step 3: Write the migration**

```sql
-- src/persistence/migrations/003_searches.sql
CREATE TABLE searches (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  search_key TEXT NOT NULL,
  product_category TEXT NOT NULL,
  state TEXT NOT NULL,
  current_page INTEGER NOT NULL DEFAULT 0,
  result_count INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs (id),
  UNIQUE (job_id, search_key)
);

CREATE INDEX idx_searches_job_id ON searches (job_id);
```

- [ ] **Step 4: Write `src/search/searchConfig.ts`**

```ts
// src/search/searchConfig.ts
export interface ConfiguredSearch {
  searchKey: string;
  productCategory: string;
}

// Verified 2026-09-17 against the real TN Tenders Advanced Search page's
// Product Category dropdown (99 total values) -- these 7 are the exact
// values matching the spec's "5 categories -> 7 searches" model, where
// Miscellaneous is split across Goods/Services/Works.
export const CONFIGURED_SEARCHES: ConfiguredSearch[] = [
  { searchKey: 'search_1', productCategory: 'Computer- H/W' },
  { searchKey: 'search_2', productCategory: 'Computer- S/W' },
  { searchKey: 'search_3', productCategory: 'Information Technology' },
  { searchKey: 'search_4', productCategory: 'Info. Tech. Services' },
  { searchKey: 'search_5', productCategory: 'Miscellaneous Goods' },
  { searchKey: 'search_6', productCategory: 'Miscellaneous Services' },
  { searchKey: 'search_7', productCategory: 'Miscellaneous Works' },
];
```

- [ ] **Step 5: Write `src/persistence/repositories/searchRepository.ts`**

```ts
// src/persistence/repositories/searchRepository.ts
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type SearchState = 'PENDING' | 'RUNNING' | 'PAGINATING' | 'COMPLETE' | 'INTERRUPTED';

export interface SearchRow {
  id: string;
  job_id: string;
  search_key: string;
  product_category: string;
  state: SearchState;
  current_page: number;
  result_count: number | null;
  created_at: string;
  updated_at: string;
}

export class SearchRepository {
  constructor(private db: DatabaseSync) {}

  create(jobId: string, searchKey: string, productCategory: string): SearchRow {
    const now = new Date().toISOString();
    const row: SearchRow = {
      id: randomUUID(),
      job_id: jobId,
      search_key: searchKey,
      product_category: productCategory,
      state: 'PENDING',
      current_page: 0,
      result_count: null,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO searches (id, job_id, search_key, product_category, state, current_page, result_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.job_id,
        row.search_key,
        row.product_category,
        row.state,
        row.current_page,
        row.result_count,
        row.created_at,
        row.updated_at
      );
    return row;
  }

  getById(id: string): SearchRow | undefined {
    return this.db.prepare('SELECT * FROM searches WHERE id = ?').get(id) as SearchRow | undefined;
  }

  findByJobAndKey(jobId: string, searchKey: string): SearchRow | undefined {
    return this.db
      .prepare('SELECT * FROM searches WHERE job_id = ? AND search_key = ?')
      .get(jobId, searchKey) as SearchRow | undefined;
  }

  listForJob(jobId: string): SearchRow[] {
    return this.db
      .prepare('SELECT * FROM searches WHERE job_id = ? ORDER BY search_key ASC')
      .all(jobId) as unknown as SearchRow[];
  }

  /** @internal Use through the search-execution orchestrator (Plan 6) once it exists. */
  updateState(id: string, state: SearchState): void {
    this.db
      .prepare('UPDATE searches SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, new Date().toISOString(), id);
  }

  updateProgress(id: string, currentPage: number, resultCount: number | null): void {
    this.db
      .prepare('UPDATE searches SET current_page = ?, result_count = ?, updated_at = ? WHERE id = ?')
      .run(currentPage, resultCount, new Date().toISOString(), id);
  }

  findFirstIncomplete(jobId: string): SearchRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM searches WHERE job_id = ? AND state NOT IN ('COMPLETE') ORDER BY search_key ASC LIMIT 1`
      )
      .get(jobId) as SearchRow | undefined;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/persistence/repositories/searchRepository.test.ts`
Expected: 7 passed.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: 96/96 passing (89 from Plans 1-4 + 7 new), typecheck clean on both configs.

- [ ] **Step 8: Commit**

```bash
git add src/persistence/migrations/003_searches.sql src/search/searchConfig.ts src/persistence/repositories/searchRepository.ts tests/persistence/repositories/searchRepository.test.ts
git commit -m "feat: configured search data and searches persistence"
```

---

### Task 2: `tenders` persistence

**Files:**
- Create: `src/persistence/migrations/004_tenders.sql`
- Create: `src/persistence/repositories/tenderRepository.ts`
- Test: `tests/persistence/repositories/tenderRepository.test.ts`

**Interfaces:**
- Consumes: `createDatabase`/`runMigrations`/`JobRepository` (Plan 1, test setup).
- Produces: `interface TenderRow { id, job_id, tender_ref, tender_portal_id, title, organisation_chain, published_date, closing_date, opening_date, product_category, created_at, updated_at }`; `interface CreateTenderInput { jobId, tenderRef, tenderPortalId, title, organisationChain, publishedDate, closingDate, openingDate, productCategory }`; `class TenderRepository { upsert(input: CreateTenderInput): TenderRow; findByJobAndRef(jobId, tenderRef): TenderRow | undefined; listForJob(jobId): TenderRow[] }`. `upsert` is idempotent on `(job_id, tender_ref)` — calling it twice with the same pair returns the existing row unchanged, which is how a tender appearing in more than one of the 7 searches gets deduplicated (per the spec's §44 "duplicate tender across configured searches" test scenario).

- [ ] **Step 1: Write the failing test**

```ts
// tests/persistence/repositories/tenderRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';
import { TenderRepository, type CreateTenderInput } from '../../../src/persistence/repositories/tenderRepository.js';

describe('TenderRepository', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let repo: TenderRepository;
  let jobId: string;

  const baseInput = (overrides: Partial<CreateTenderInput> = {}): CreateTenderInput => ({
    jobId,
    tenderRef: 'BU/R-D2/Software/12131',
    tenderPortalId: '2026_HE_703362_1',
    title: 'Software',
    organisationChain: 'Higher Education||Bharathiar University||Registrars office',
    publishedDate: '2026-09-10T17:00:00+05:30',
    closingDate: '2026-09-25T15:00:00+05:30',
    openingDate: '2026-09-28T16:00:00+05:30',
    productCategory: 'Computer- S/W',
    ...overrides,
  });

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    repo = new TenderRepository(db);
    jobId = jobs.create().id;
  });

  it('upsert creates a new tender row', () => {
    const tender = repo.upsert(baseInput());
    expect(tender.tender_ref).toBe('BU/R-D2/Software/12131');
    expect(tender.title).toBe('Software');
    expect(tender.product_category).toBe('Computer- S/W');
  });

  it('upsert is idempotent on (job_id, tender_ref) -- returns the existing row unchanged', () => {
    const first = repo.upsert(baseInput());
    const second = repo.upsert(baseInput({ title: 'A different title from a later search' }));

    expect(second.id).toBe(first.id);
    expect(second.title).toBe('Software');
  });

  it('findByJobAndRef returns the matching row', () => {
    repo.upsert(baseInput());
    const found = repo.findByJobAndRef(jobId, 'BU/R-D2/Software/12131');
    expect(found?.organisation_chain).toBe('Higher Education||Bharathiar University||Registrars office');
  });

  it('findByJobAndRef returns undefined for an unknown ref', () => {
    expect(repo.findByJobAndRef(jobId, 'no-such-ref')).toBeUndefined();
  });

  it('listForJob returns all tenders for the job in creation order', () => {
    repo.upsert(baseInput({ tenderRef: 'ref-1' }));
    repo.upsert(baseInput({ tenderRef: 'ref-2' }));
    const list = repo.listForJob(jobId);
    expect(list.map((t) => t.tender_ref)).toEqual(['ref-1', 'ref-2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/persistence/repositories/tenderRepository.test.ts`
Expected: FAIL — cannot find module `tenderRepository.js`.

- [ ] **Step 3: Write the migration**

```sql
-- src/persistence/migrations/004_tenders.sql
CREATE TABLE tenders (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  tender_ref TEXT NOT NULL,
  tender_portal_id TEXT,
  title TEXT NOT NULL,
  organisation_chain TEXT,
  published_date TEXT,
  closing_date TEXT,
  opening_date TEXT,
  product_category TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs (id),
  UNIQUE (job_id, tender_ref)
);

CREATE INDEX idx_tenders_job_id ON tenders (job_id);
```

- [ ] **Step 4: Write `src/persistence/repositories/tenderRepository.ts`**

```ts
// src/persistence/repositories/tenderRepository.ts
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface TenderRow {
  id: string;
  job_id: string;
  tender_ref: string;
  tender_portal_id: string | null;
  title: string;
  organisation_chain: string | null;
  published_date: string | null;
  closing_date: string | null;
  opening_date: string | null;
  product_category: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTenderInput {
  jobId: string;
  tenderRef: string;
  tenderPortalId: string | null;
  title: string;
  organisationChain: string | null;
  publishedDate: string | null;
  closingDate: string | null;
  openingDate: string | null;
  productCategory: string;
}

export class TenderRepository {
  constructor(private db: DatabaseSync) {}

  upsert(input: CreateTenderInput): TenderRow {
    const existing = this.findByJobAndRef(input.jobId, input.tenderRef);
    if (existing) return existing;

    const now = new Date().toISOString();
    const row: TenderRow = {
      id: randomUUID(),
      job_id: input.jobId,
      tender_ref: input.tenderRef,
      tender_portal_id: input.tenderPortalId,
      title: input.title,
      organisation_chain: input.organisationChain,
      published_date: input.publishedDate,
      closing_date: input.closingDate,
      opening_date: input.openingDate,
      product_category: input.productCategory,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO tenders (id, job_id, tender_ref, tender_portal_id, title, organisation_chain, published_date, closing_date, opening_date, product_category, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.job_id,
        row.tender_ref,
        row.tender_portal_id,
        row.title,
        row.organisation_chain,
        row.published_date,
        row.closing_date,
        row.opening_date,
        row.product_category,
        row.created_at,
        row.updated_at
      );
    return row;
  }

  findByJobAndRef(jobId: string, tenderRef: string): TenderRow | undefined {
    return this.db
      .prepare('SELECT * FROM tenders WHERE job_id = ? AND tender_ref = ?')
      .get(jobId, tenderRef) as TenderRow | undefined;
  }

  listForJob(jobId: string): TenderRow[] {
    return this.db
      .prepare('SELECT * FROM tenders WHERE job_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(jobId) as unknown as TenderRow[];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/persistence/repositories/tenderRepository.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: 101/101 passing, typecheck clean on both configs.

- [ ] **Step 7: Commit**

```bash
git add src/persistence/migrations/004_tenders.sql src/persistence/repositories/tenderRepository.ts tests/persistence/repositories/tenderRepository.test.ts
git commit -m "feat: tenders persistence with job-scoped dedup by tender_ref"
```

---

### Task 3: Tender portal date parser

**Files:**
- Create: `src/search/tenderDateParser.ts`
- Test: `tests/search/tenderDateParser.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `function parseTenderPortalDate(raw: string): string | null`. Task 4's row parser and Plan 6's Gate 1 caller both use this to convert the portal's displayed date strings into ISO 8601.

- [ ] **Step 1: Write the failing test**

```ts
// tests/search/tenderDateParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseTenderPortalDate } from '../../src/search/tenderDateParser.js';

describe('parseTenderPortalDate', () => {
  it('parses a real captured PM timestamp to ISO with the +05:30 (IST) offset', () => {
    expect(parseTenderPortalDate('11-Sep-2026 06:00 PM')).toBe('2026-09-11T18:00:00+05:30');
  });

  it('parses a real captured AM timestamp', () => {
    expect(parseTenderPortalDate('29-Sep-2026 11:00 AM')).toBe('2026-09-29T11:00:00+05:30');
  });

  it('handles 12:00 PM (noon) correctly', () => {
    expect(parseTenderPortalDate('01-Oct-2026 12:00 PM')).toBe('2026-10-01T12:00:00+05:30');
  });

  it('handles 12:00 AM (midnight) correctly', () => {
    expect(parseTenderPortalDate('01-Oct-2026 12:00 AM')).toBe('2026-10-01T00:00:00+05:30');
  });

  it('returns null for unparseable input', () => {
    expect(parseTenderPortalDate('not a date')).toBeNull();
    expect(parseTenderPortalDate('')).toBeNull();
    expect(parseTenderPortalDate('2026-09-11 18:00')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/search/tenderDateParser.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/search/tenderDateParser.ts
const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

// TN Tenders displays every date/time as DD-MMM-YYYY HH:MM AM/PM in IST
// (UTC+5:30), verified against the real portal. Encode the offset
// explicitly rather than assuming the machine's local timezone.
export function parseTenderPortalDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  const [, day, monthAbbr, year, hourStr, minute, meridiemRaw] = match;
  const monthKey = monthAbbr[0].toUpperCase() + monthAbbr.slice(1, 3).toLowerCase();
  const month = MONTHS[monthKey];
  if (!month) return null;

  let hour = parseInt(hourStr, 10);
  const meridiem = meridiemRaw.toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  const hourPadded = String(hour).padStart(2, '0');
  return `${year}-${month}-${day}T${hourPadded}:${minute}:00+05:30`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/search/tenderDateParser.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/search/tenderDateParser.ts tests/search/tenderDateParser.test.ts
git commit -m "feat: TN Tenders portal date string parser"
```

---

### Task 4: Tender result-row parser

**Files:**
- Create: `src/search/tenderRowParser.ts`
- Test: `tests/search/tenderRowParser.test.ts`

**Interfaces:**
- Consumes: nothing (pure function; does not import Task 3's date parser — dates are returned as raw display strings, parsing them is the caller's job, keeping this function focused solely on splitting the row into fields).
- Produces: `interface ParsedTenderRow { ePublishedDate: string; closingDate: string; openingDate: string; title: string; tenderReferenceNumber: string; tenderPortalId: string; organisationChain: string[] }`; `function parseTenderRow(cells: string[]): ParsedTenderRow | null`. Plan 6 calls this with an array of `<td>` text contents extracted from a real search-results row (one array per row, `[serialNo, ePublishedDate, closingDate, openingDate, titleAndRefCell, organisationChainCell]` — 6 elements, matching the real table's column count).

- [ ] **Step 1: Write the failing test**

```ts
// tests/search/tenderRowParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseTenderRow } from '../../src/search/tenderRowParser.js';

describe('parseTenderRow', () => {
  it('parses a real captured row with a long title and 3-level organisation chain', () => {
    const cells = [
      '1.',
      '11-Sep-2026 06:00 PM',
      '28-Sep-2026 11:00 AM',
      '29-Sep-2026 11:00 AM',
      '[Purchase of MATLAB with Simulink and Automotive related Tool Boxes for Establishment of Electric Vehicle Technology Laboratory in 3 Government Engineering Colleges at Tirunelveli, Dharmapuri and Erode] [GCE/TLY/5184/A2/2026][2026_DoTE_704004_1]',
      'Directorate of Technical Education||Govt. Engineering College - DOTE||Government College of Engineering - Tirunelveli',
    ];

    const parsed = parseTenderRow(cells);
    expect(parsed).toEqual({
      ePublishedDate: '11-Sep-2026 06:00 PM',
      closingDate: '28-Sep-2026 11:00 AM',
      openingDate: '29-Sep-2026 11:00 AM',
      title:
        'Purchase of MATLAB with Simulink and Automotive related Tool Boxes for Establishment of Electric Vehicle Technology Laboratory in 3 Government Engineering Colleges at Tirunelveli, Dharmapuri and Erode',
      tenderReferenceNumber: 'GCE/TLY/5184/A2/2026',
      tenderPortalId: '2026_DoTE_704004_1',
      organisationChain: [
        'Directorate of Technical Education',
        'Govt. Engineering College - DOTE',
        'Government College of Engineering - Tirunelveli',
      ],
    });
  });

  it('parses a real captured row with a short title and 3-level organisation chain', () => {
    const cells = [
      '2.',
      '10-Sep-2026 05:00 PM',
      '25-Sep-2026 03:00 PM',
      '28-Sep-2026 04:00 PM',
      '[Software] [BU/R-D2/Software/12131][2026_HE_703362_1]',
      'Higher Education||Bharathiar University||Registrars office',
    ];

    const parsed = parseTenderRow(cells);
    expect(parsed).toEqual({
      ePublishedDate: '10-Sep-2026 05:00 PM',
      closingDate: '25-Sep-2026 03:00 PM',
      openingDate: '28-Sep-2026 04:00 PM',
      title: 'Software',
      tenderReferenceNumber: 'BU/R-D2/Software/12131',
      tenderPortalId: '2026_HE_703362_1',
      organisationChain: ['Higher Education', 'Bharathiar University', 'Registrars office'],
    });
  });

  it('parses a real captured row with a 2-level organisation chain', () => {
    const cells = [
      '3.',
      '05-Sep-2026 03:00 PM',
      '01-Oct-2026 03:00 PM',
      '01-Oct-2026 03:30 PM',
      '[Empanelment of Software] [ANGADI-RC-IT02-2026-0020][2026_ELCO_701728_1]',
      'ELCOT||Procurement',
    ];

    const parsed = parseTenderRow(cells);
    expect(parsed?.title).toBe('Empanelment of Software');
    expect(parsed?.tenderReferenceNumber).toBe('ANGADI-RC-IT02-2026-0020');
    expect(parsed?.tenderPortalId).toBe('2026_ELCO_701728_1');
    expect(parsed?.organisationChain).toEqual(['ELCOT', 'Procurement']);
  });

  it('returns null when the row has fewer than 6 cells', () => {
    expect(parseTenderRow(['1.', 'only', 'four', 'cells'])).toBeNull();
  });

  it('returns null when the title cell does not match the [Title] [Ref][Id] pattern', () => {
    const cells = ['1.', 'x', 'x', 'x', 'not bracketed at all', 'Org'];
    expect(parseTenderRow(cells)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/search/tenderRowParser.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/search/tenderRowParser.ts
export interface ParsedTenderRow {
  ePublishedDate: string;
  closingDate: string;
  openingDate: string;
  title: string;
  tenderReferenceNumber: string;
  tenderPortalId: string;
  organisationChain: string[];
}

// Real captured format: "[Title] [RefNo][TenderPortalId]" -- one space
// after the title's closing bracket, zero spaces between the ref-number
// and tender-portal-id brackets.
const TITLE_REF_ID_PATTERN = /^\[(.+)\]\s*\[([^\]]+)\]\[([^\]]+)\]$/;

export function parseTenderRow(cells: string[]): ParsedTenderRow | null {
  if (cells.length < 6) return null;
  const [, ePublishedDate, closingDate, openingDate, titleCell, organisationChainCell] = cells;

  const match = titleCell.trim().match(TITLE_REF_ID_PATTERN);
  if (!match) return null;
  const [, title, tenderReferenceNumber, tenderPortalId] = match;

  return {
    ePublishedDate: ePublishedDate.trim(),
    closingDate: closingDate.trim(),
    openingDate: openingDate.trim(),
    title: title.trim(),
    tenderReferenceNumber: tenderReferenceNumber.trim(),
    tenderPortalId: tenderPortalId.trim(),
    organisationChain: organisationChainCell
      .split('||')
      .map((part) => part.trim())
      .filter(Boolean),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/search/tenderRowParser.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: 112/112 passing (101 from Tasks 1-2 + 6 date-parser + 5 row-parser), typecheck clean on both configs.

- [ ] **Step 6: Commit**

```bash
git add src/search/tenderRowParser.ts tests/search/tenderRowParser.test.ts
git commit -m "feat: tender search-result row parser, fixtures from real captured portal data"
```

---

### Task 5: Gate 1 (freshness) and Gate 2 (product category)

**Files:**
- Create: `src/classification/gate1Freshness.ts`
- Create: `src/classification/gate2ProductCategory.ts`
- Test: `tests/classification/gate1Freshness.test.ts`
- Test: `tests/classification/gate2ProductCategory.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces: `interface Gate1Result { gate: 'G1'; result: 'PASS' | 'REJECT'; reason_code: 'WITHIN_FRESHNESS_WINDOW' | 'OUTSIDE_FRESHNESS_WINDOW' | 'UNPARSEABLE_PUBLISHED_DATE'; published_date: string | null; evaluated_against: string }`; `function evaluateGate1(publishedDateIso: string | null, evaluatedAgainstIso: string, freshnessWindowDays: number): Gate1Result`. `interface Gate2Result { gate: 'G2'; result: 'PASS' | 'REJECT'; reason_code: 'PRODUCT_CATEGORY_MATCH' | 'PRODUCT_CATEGORY_MISMATCH'; product_category: string }`; `function evaluateGate2(tenderProductCategory: string, configuredProductCategory: string): Gate2Result`. Both match the spec's §9/§10 exact JSON shape (`gate`, `result`, `reason_code`, plus gate-specific evidence fields) — a future classification-persistence task stores these results directly.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/classification/gate1Freshness.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateGate1 } from '../../src/classification/gate1Freshness.js';

describe('evaluateGate1', () => {
  it('passes when the published date is within the freshness window', () => {
    const result = evaluateGate1('2026-09-11T18:00:00+05:30', '2026-09-15T00:00:00+05:30', 7);
    expect(result).toEqual({
      gate: 'G1',
      result: 'PASS',
      reason_code: 'WITHIN_FRESHNESS_WINDOW',
      published_date: '2026-09-11T18:00:00+05:30',
      evaluated_against: '2026-09-15T00:00:00+05:30',
    });
  });

  it('rejects when the published date is outside the freshness window', () => {
    const result = evaluateGate1('2026-09-01T00:00:00+05:30', '2026-09-15T00:00:00+05:30', 7);
    expect(result.result).toBe('REJECT');
    expect(result.reason_code).toBe('OUTSIDE_FRESHNESS_WINDOW');
  });

  it('rejects with UNPARSEABLE_PUBLISHED_DATE when the published date is null', () => {
    const result = evaluateGate1(null, '2026-09-15T00:00:00+05:30', 7);
    expect(result.result).toBe('REJECT');
    expect(result.reason_code).toBe('UNPARSEABLE_PUBLISHED_DATE');
    expect(result.published_date).toBeNull();
  });

  it('rejects a published date that is after the evaluation date', () => {
    const result = evaluateGate1('2026-09-20T00:00:00+05:30', '2026-09-15T00:00:00+05:30', 7);
    expect(result.result).toBe('REJECT');
    expect(result.reason_code).toBe('OUTSIDE_FRESHNESS_WINDOW');
  });

  it('passes exactly at the boundary of the freshness window', () => {
    const result = evaluateGate1('2026-09-08T00:00:00+05:30', '2026-09-15T00:00:00+05:30', 7);
    expect(result.result).toBe('PASS');
  });
});
```

```ts
// tests/classification/gate2ProductCategory.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateGate2 } from '../../src/classification/gate2ProductCategory.js';

describe('evaluateGate2', () => {
  it('passes on an exact match', () => {
    const result = evaluateGate2('Computer- S/W', 'Computer- S/W');
    expect(result).toEqual({
      gate: 'G2',
      result: 'PASS',
      reason_code: 'PRODUCT_CATEGORY_MATCH',
      product_category: 'Computer- S/W',
    });
  });

  it('passes on a case-insensitive match', () => {
    const result = evaluateGate2('computer- s/w', 'Computer- S/W');
    expect(result.result).toBe('PASS');
  });

  it('rejects a mismatch', () => {
    const result = evaluateGate2('Miscellaneous Goods', 'Computer- S/W');
    expect(result.result).toBe('REJECT');
    expect(result.reason_code).toBe('PRODUCT_CATEGORY_MISMATCH');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/classification/`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Write minimal implementations**

```ts
// src/classification/gate1Freshness.ts
export interface Gate1Result {
  gate: 'G1';
  result: 'PASS' | 'REJECT';
  reason_code: 'WITHIN_FRESHNESS_WINDOW' | 'OUTSIDE_FRESHNESS_WINDOW' | 'UNPARSEABLE_PUBLISHED_DATE';
  published_date: string | null;
  evaluated_against: string;
}

export function evaluateGate1(
  publishedDateIso: string | null,
  evaluatedAgainstIso: string,
  freshnessWindowDays: number
): Gate1Result {
  if (!publishedDateIso) {
    return {
      gate: 'G1',
      result: 'REJECT',
      reason_code: 'UNPARSEABLE_PUBLISHED_DATE',
      published_date: null,
      evaluated_against: evaluatedAgainstIso,
    };
  }

  const publishedMs = Date.parse(publishedDateIso);
  const evaluatedMs = Date.parse(evaluatedAgainstIso);
  const windowMs = freshnessWindowDays * 24 * 60 * 60 * 1000;
  const withinWindow = evaluatedMs >= publishedMs && evaluatedMs - publishedMs <= windowMs;

  return {
    gate: 'G1',
    result: withinWindow ? 'PASS' : 'REJECT',
    reason_code: withinWindow ? 'WITHIN_FRESHNESS_WINDOW' : 'OUTSIDE_FRESHNESS_WINDOW',
    published_date: publishedDateIso,
    evaluated_against: evaluatedAgainstIso,
  };
}
```

```ts
// src/classification/gate2ProductCategory.ts
export interface Gate2Result {
  gate: 'G2';
  result: 'PASS' | 'REJECT';
  reason_code: 'PRODUCT_CATEGORY_MATCH' | 'PRODUCT_CATEGORY_MISMATCH';
  product_category: string;
}

export function evaluateGate2(tenderProductCategory: string, configuredProductCategory: string): Gate2Result {
  const match = tenderProductCategory.trim().toLowerCase() === configuredProductCategory.trim().toLowerCase();
  return {
    gate: 'G2',
    result: match ? 'PASS' : 'REJECT',
    reason_code: match ? 'PRODUCT_CATEGORY_MATCH' : 'PRODUCT_CATEGORY_MISMATCH',
    product_category: tenderProductCategory,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/classification/`
Expected: 8 passed (5 Gate 1 + 3 Gate 2).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: 120/120 passing, typecheck clean on both configs.

- [ ] **Step 6: Commit**

```bash
git add src/classification/gate1Freshness.ts src/classification/gate2ProductCategory.ts tests/classification/
git commit -m "feat: deterministic Gate 1 (freshness) and Gate 2 (product category) classification"
```

---

## Self-Review Notes

- **Spec coverage:** search model (§7, persisted as `searches`), tender metadata capture, Gate 1/Gate 2 exact JSON shapes (§9-10) and audit requirements (§14) are all covered. The classification-persistence table (`tender_classification_gates` from the original architecture) and Gates 3/4 (semantic) are intentionally deferred — this plan only builds the two deterministic gates as pure functions; persisting their results alongside G3/G4 is a later plan's job once the semantic model provider exists.
- **Placeholder scan:** no TBD/TODO markers; every test uses real captured portal data as fixtures, not synthesized examples.
- **Type consistency:** `ParsedTenderRow` (Task 4) intentionally does NOT get threaded directly into `CreateTenderInput` (Task 2) in this plan — Plan 6 is responsible for mapping one to the other (including running dates through Task 3's `parseTenderPortalDate`), since that mapping requires the live search context (which `jobId`, which configured search) neither pure module has.

## Next Plan

Plan 6 (not yet written): live search execution — filling the Advanced Search form via the retained `AuthFlow`/`BrowserController` page, submitting the 7 configured searches sequentially, extracting real table rows into cell arrays for Task 4's parser, handling pagination, and persisting results via Tasks 1-2's repositories. Must first confirm live whether the CAPTCHA genuinely stays absent once authenticated (per the user's stated experience, not yet independently verified in a live session) — if it reappears, that changes Plan 6's scope substantially and needs a design conversation before proceeding.
