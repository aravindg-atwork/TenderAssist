# Search Execution — Search + Review + Favorite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a job reaches `AUTHENTICATED`, automatically run all 7 configured category searches on the real TN Tenders portal, persist every result row, favorite each one, and land the job in `CLASSIFYING` — visible live in the Electron dashboard.

**Architecture:** A new orchestration function, `runSearchPhase` (`src/orchestration/searchPhaseRunner.ts`), takes the SAME retained Playwright `Page` the auth phase already attached (exposed via a new optional `onAttached` callback on `runAuthJob`, added without touching that function's existing return contract), and drives category-by-category search + favorite using a new `searchFormController.ts` (real browser interaction) and `activeTenderRowParser.ts` (pure parsing). `main.ts`'s `start-job` handler chains `runSearchPhase` after `runAuthJob` resolves SUCCESS, moving today's "kill Chrome to release the profile lock" cleanup to after both phases settle instead of right after auth.

**Tech Stack:** Same as every prior plan — TypeScript strict, `node:sqlite`, Playwright (`playwright-core`) over CDP, Vitest with `describe.skipIf(!CHROME_PATH)` real-Chrome coverage, Electron/React renderer.

**Spec:** `docs/superpowers/specs/2026-09-21-search-execution-design.md`. Also references `docs/superpowers/specs/2026-09-17-tenderassist-architecture.md` and `docs/superpowers/specs/2026-09-18-electron-dashboard-design.md`.

**Depends on:** the completed Electron dashboard auth-flow milestone. Imports `AuthJobUpdate`/`runAuthJob` (`src/orchestration/authJobRunner.ts`), `JobRepository`/`JobState` (`src/persistence/repositories/jobRepository.ts`), `AuthSessionRepository`/`AuthState` (`src/persistence/repositories/authSessionRepository.ts`), `JobStateMachine` (`src/state/jobStateMachine.ts`), `SearchRepository`/`SearchRow` (`src/persistence/repositories/searchRepository.ts`), `TenderRepository`/`CreateTenderInput` (`src/persistence/repositories/tenderRepository.ts`), `CONFIGURED_SEARCHES` (`src/search/searchConfig.ts`).

## Global Constraints

- `node:sqlite` typing conventions from every prior plan apply: positional `.run()` params, `unknown`-first `.all()` casts.
- TypeScript strict mode; no `any`. `src/**/*.ts` imports keep the `.js` suffix (NodeNext); `renderer/**/*.tsx` imports do not (Bundler resolution).
- No new dependencies — everything needed (`playwright-core`, React, `node:sqlite`) is already installed.
- Every real-portal interaction (form fields, table structure, the favorite button) must match the markup captured live on 2026-09-21 and recorded in the spec — do not invent selectors. Where the spec flags something as unconfirmed (pagination), build defensively and say so in a comment; don't guess at exact markup.
- `runAuthJob`'s existing return contract and all 3 of its existing test cases must keep passing unmodified — the search phase is additive, never a rewrite of the auth flow.
- No automated test suite for the Electron shell/React renderer changes in this plan either, consistent with the auth-flow milestone — verification is manual (final Task).

---

### Task 1: Fix the category list and lock it in with a test

**Files:**
- Modify: `src/search/searchConfig.ts`
- Test: `tests/search/searchConfig.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CONFIGURED_SEARCHES: ConfiguredSearch[]` (existing type, corrected data) — every later task in this plan iterates this array.

- [ ] **Step 1: Write the failing test**

```ts
// tests/search/searchConfig.test.ts
import { describe, it, expect } from 'vitest';
import { CONFIGURED_SEARCHES } from '../../src/search/searchConfig.js';

describe('CONFIGURED_SEARCHES', () => {
  it('has exactly the 7 real production category searches, confirmed live 2026-09-21', () => {
    const categories = CONFIGURED_SEARCHES.map((s) => s.productCategory);
    expect(categories).toEqual([
      'Computer- S/W',
      'Information Technology',
      'Info. Tech. Services',
      'Documentary film,Video film',
      'Miscellaneous Goods',
      'Miscellaneous Services',
      'Miscellaneous Works',
    ]);
  });

  it('never includes Computer- H/W (hardware is explicitly out of scope)', () => {
    expect(CONFIGURED_SEARCHES.map((s) => s.productCategory)).not.toContain('Computer- H/W');
  });

  it('every search key is unique', () => {
    const keys = CONFIGURED_SEARCHES.map((s) => s.searchKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/search/searchConfig.test.ts`
Expected: FAIL — first assertion fails, actual array still contains `Computer- H/W` and is missing `Documentary film,Video film`.

- [ ] **Step 3: Fix the config**

Replace `src/search/searchConfig.ts`'s contents with:

```ts
export interface ConfiguredSearch {
  searchKey: string;
  productCategory: string;
}

// Verified live 2026-09-21 against the real, authenticated TN Tenders
// Advanced Search page's Product Category dropdown (94 total values) -- all
// 7 of these exist verbatim as separate options. Computer- H/W is a real,
// separate option too, but is explicitly out of scope (hardware) -- do not
// add it back. See docs/superpowers/specs/2026-09-21-search-execution-design.md.
export const CONFIGURED_SEARCHES: ConfiguredSearch[] = [
  { searchKey: 'search_1', productCategory: 'Computer- S/W' },
  { searchKey: 'search_2', productCategory: 'Information Technology' },
  { searchKey: 'search_3', productCategory: 'Info. Tech. Services' },
  { searchKey: 'search_4', productCategory: 'Documentary film,Video film' },
  { searchKey: 'search_5', productCategory: 'Miscellaneous Goods' },
  { searchKey: 'search_6', productCategory: 'Miscellaneous Services' },
  { searchKey: 'search_7', productCategory: 'Miscellaneous Works' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/search/searchConfig.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all passing (135 + 3 new = 138), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/search/searchConfig.ts tests/search/searchConfig.test.ts
git commit -m "fix: correct the 7 configured category searches to match the real live portal dropdown"
```

---

### Task 2: Extend `TenderRepository` for value + favorite tracking

**Files:**
- Create: `src/persistence/migrations/005_active_tenders.sql`
- Modify: `src/persistence/repositories/tenderRepository.ts`
- Modify: `tests/persistence/repositories/tenderRepository.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CreateTenderInput` gains `valueInRupees: string`; `TenderRow` gains `value_in_rupees: string`, `favorited: 0 | 1`, `favorited_at: string | null`; new method `TenderRepository.markFavorited(id: string, favoritedAt: string): void`. Task 5's `runSearchPhase` calls both `upsert()` (with the new field) and `markFavorited()` directly.

- [ ] **Step 1: Write the migration**

```sql
-- src/persistence/migrations/005_active_tenders.sql
ALTER TABLE tenders ADD COLUMN value_in_rupees TEXT NOT NULL DEFAULT 'NA';
ALTER TABLE tenders ADD COLUMN favorited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenders ADD COLUMN favorited_at TEXT;
```

- [ ] **Step 2: Write the failing tests**

Add these to the existing `describe('TenderRepository', ...)` block in `tests/persistence/repositories/tenderRepository.test.ts` (alongside the existing tests -- do not modify any of them except `baseInput`, below):

Update `baseInput` to include the new required field:

```ts
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
    valueInRupees: 'NA',
    ...overrides,
  });
```

Then add:

```ts
  it('upsert stores value_in_rupees and defaults favorited to false', () => {
    const tender = repo.upsert(baseInput({ valueInRupees: '1,50,000' }));
    expect(tender.value_in_rupees).toBe('1,50,000');
    expect(tender.favorited).toBe(0);
    expect(tender.favorited_at).toBeNull();
  });

  it('markFavorited sets favorited and favorited_at', () => {
    const tender = repo.upsert(baseInput());
    repo.markFavorited(tender.id, '2026-09-21T06:00:00.000Z');

    const fetched = repo.findByJobAndRef(jobId, tender.tender_ref)!;
    expect(fetched.favorited).toBe(1);
    expect(fetched.favorited_at).toBe('2026-09-21T06:00:00.000Z');
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/persistence/repositories/tenderRepository.test.ts`
Expected: FAIL — `valueInRupees` missing from type / `repo.markFavorited is not a function`.

- [ ] **Step 4: Extend the repository**

In `src/persistence/repositories/tenderRepository.ts`, replace the file's contents with:

```ts
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
  value_in_rupees: string;
  favorited: 0 | 1;
  favorited_at: string | null;
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
  valueInRupees: string;
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
      value_in_rupees: input.valueInRupees,
      favorited: 0,
      favorited_at: null,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO tenders (id, job_id, tender_ref, tender_portal_id, title, organisation_chain, published_date, closing_date, opening_date, product_category, value_in_rupees, favorited, favorited_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        row.value_in_rupees,
        row.favorited,
        row.favorited_at,
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

  markFavorited(id: string, favoritedAt: string): void {
    this.db
      .prepare('UPDATE tenders SET favorited = 1, favorited_at = ?, updated_at = ? WHERE id = ?')
      .run(favoritedAt, new Date().toISOString(), id);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/persistence/repositories/tenderRepository.test.ts`
Expected: 7 passed (5 existing + 2 new).

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all passing, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/persistence/migrations/005_active_tenders.sql src/persistence/repositories/tenderRepository.ts tests/persistence/repositories/tenderRepository.test.ts
git commit -m "feat: track tender value and favorited status on the tenders table"
```

---

### Task 3: `activeTenderRowParser.ts` — parse the real results table

**Files:**
- Create: `src/search/activeTenderRowParser.ts`
- Test: `tests/search/activeTenderRowParser.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `interface ParsedActiveTenderRow { serialNo: string; tenderId: string; title: string; referenceNumber: string; productCategory: string; valueInRupees: string }`; `function parseActiveTenderRow(cells: string[]): ParsedActiveTenderRow | null`. Task 4's `searchFormController.ts` calls this for every extracted table row.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/search/activeTenderRowParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseActiveTenderRow } from '../../src/search/activeTenderRowParser.js';

describe('parseActiveTenderRow', () => {
  // Real row captured live 2026-09-21 from an authenticated Search Active
  // Tenders results table (Information Technology category).
  const realCells = [
    '1.',
    '2026_EB_705493_1',
    'AMC for Open  Access Energy Adjustment and Accounting Software with presence of one Technical Person On-site for a period of Two Years ',
    'CE/IT and RAPDRP-11/2026-27',
    'Information Technology',
    'NA',
  ];

  it('parses a real captured row', () => {
    const result = parseActiveTenderRow(realCells);
    expect(result).toEqual({
      serialNo: '1.',
      tenderId: '2026_EB_705493_1',
      title: 'AMC for Open  Access Energy Adjustment and Accounting Software with presence of one Technical Person On-site for a period of Two Years',
      referenceNumber: 'CE/IT and RAPDRP-11/2026-27',
      productCategory: 'Information Technology',
      valueInRupees: 'NA',
    });
  });

  it('trims each cell', () => {
    const result = parseActiveTenderRow(['  1.  ', ' id ', ' title ', ' ref ', ' cat ', '  1,000  ']);
    expect(result).toEqual({
      serialNo: '1.',
      tenderId: 'id',
      title: 'title',
      referenceNumber: 'ref',
      productCategory: 'cat',
      valueInRupees: '1,000',
    });
  });

  it('returns null when there are fewer than 6 cells (e.g. the table footer row)', () => {
    expect(parseActiveTenderRow(['footer text'])).toBeNull();
  });

  it('returns null for an empty cells array', () => {
    expect(parseActiveTenderRow([])).toBeNull();
  });

  it('ignores any 7th+ cell (the Favorite checkbox column is handled separately, not parsed as text)', () => {
    const result = parseActiveTenderRow([...realCells, 'ignored favorite cell content']);
    expect(result?.valueInRupees).toBe('NA');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/search/activeTenderRowParser.test.ts`
Expected: FAIL — cannot find module `../../src/search/activeTenderRowParser.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/search/activeTenderRowParser.ts
export interface ParsedActiveTenderRow {
  serialNo: string;
  tenderId: string;
  title: string;
  referenceNumber: string;
  productCategory: string;
  valueInRupees: string;
}

// Real Search Active Tenders results table, captured live 2026-09-21 against
// an authenticated session: S.No | Tender ID | Tender Title | Tender
// Reference Number | Product Category | Value in Rs | Favorite. This is a
// DIFFERENT page/table than src/search/tenderRowParser.ts targets -- that
// file's cell shape (published/closing/opening dates, a bracket-embedded
// title) does not match this table at all, so this is a new, separately
// named parser rather than a repurposing of that one. See
// docs/superpowers/specs/2026-09-21-search-execution-design.md.
export function parseActiveTenderRow(cells: string[]): ParsedActiveTenderRow | null {
  if (cells.length < 6) return null;
  const [serialNo, tenderId, title, referenceNumber, productCategory, valueInRupees] = cells;

  return {
    serialNo: serialNo.trim(),
    tenderId: tenderId.trim(),
    title: title.trim(),
    referenceNumber: referenceNumber.trim(),
    productCategory: productCategory.trim(),
    valueInRupees: valueInRupees.trim(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/search/activeTenderRowParser.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all passing, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/search/activeTenderRowParser.ts tests/search/activeTenderRowParser.test.ts
git commit -m "feat: parser for the real Search Active Tenders results table"
```

---

### Task 4: `searchFormController.ts` — real browser interaction

**Files:**
- Create: `src/browser/searchFormController.ts`
- Test: `tests/browser/searchFormController.test.ts`

**Interfaces:**
- Consumes: `parseActiveTenderRow`/`ParsedActiveTenderRow` (Task 3, `src/search/activeTenderRowParser.js`).
- Produces: `function searchCategory(page: Page, productCategory: string, fromToDateDdMmYyyy: string): Promise<ParsedActiveTenderRow[]>`; `function favoriteAllVisibleRows(page: Page): Promise<number>` (returns how many checkboxes were checked). Task 5's `runSearchPhase` calls both.

This task's fixture server reproduces the real captured markup (search form fields, results table, favorite button/validation script) from the spec, the same technique `tests/browser/browserController.test.ts` already uses for the real `<img title="Logout">` markup.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/browser/searchFormController.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { searchCategory, favoriteAllVisibleRows } from '../../src/browser/searchFormController.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

// Reproduces the real search-form page and results table, captured live
// 2026-09-21 against an authenticated session (see the design spec).
const SEARCH_FORM_HTML = `<html><body>
  <a href="/results">Search Active Tenders</a>
  <select id="ProductCategory">
    <option value="">-Select-</option>
    <option>Information Technology</option>
    <option>Computer- S/W</option>
  </select>
  <select id="dateCriteria">
    <option value="0">-Select-</option>
    <option value="1">Published Date</option>
  </select>
  <input type="text" name="fromDate" id="fromDate" readonly value="">
  <input type="text" name="toDate" id="toDate" readonly value="">
  <input type="submit" id="submit" value="Search" onclick="document.location.href='/results?category=' + document.getElementById('ProductCategory').value">
</body></html>`;

function resultsHtml(rows: Array<{ id: string; title: string; ref: string; category: string; value: string }>): string {
  const rowsHtml = rows
    .map(
      (r, i) => `<tr>
        <td>${i + 1}.</td>
        <td>${r.id}</td>
        <td>${r.title}</td>
        <td>${r.ref}</td>
        <td>${r.category}</td>
        <td>${r.value}</td>
        <td><input type="checkbox" name="Checkbox" id="Checkbox"></td>
      </tr>`
    )
    .join('');
  return `<html><body>
    <a href="/">Search Active Tenders</a>
    <form id="activeTenders" action="/favorited" method="post">
      <table>
        <tr><td>S.No</td><td>Tender ID</td><td>Tender Title</td><td>Tender Reference Number</td><td>Product Category</td><td>Value in Rs</td><td>Favorite</td></tr>
        ${rowsHtml}
        <tr><td colspan="7">&nbsp;</td></tr>
      </table>
      <script>
        function checkConformSaveDocuments(f1, cname) {
          var f = document.getElementById(f1);
          var countf = 0, counti = 0;
          for (var i = 0; i < f.elements.length; i++) {
            if (f.elements[i].type === 'checkbox') {
              counti++;
              if (f.elements[i].checked) countf++;
            }
          }
          if (countf <= 0 && counti > 0) { alert('Please select atleast one ' + cname); return false; }
          if (countf <= 0 && counti <= 0) { alert('No documents available'); return false; }
          return true;
        }
      </script>
      <input type="submit" id="save" value="Set Open Tender as Favorite" onclick="return checkConformSaveDocuments('activeTenders','tender');">
    </form>
  </body></html>`;
}

describe.skipIf(!CHROME_PATH)('searchFormController', { timeout: 30_000 }, () => {
  let server: Server;
  let serverPort: number;
  let userDataDir: string;
  let chromeProc: ReturnType<typeof launchChrome>;
  let cdpPort: number;
  let currentRows: Array<{ id: string; title: string; ref: string; category: string; value: string }> = [];

  beforeEach(async () => {
    currentRows = [];
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/results')) {
        res.end(resultsHtml(currentRows));
      } else if (req.url?.startsWith('/favorited')) {
        res.end('<html><body>Favorited. <a href="/">Search Active Tenders</a></body></html>');
      } else {
        res.end(SEARCH_FORM_HTML);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as { port: number }).port;

    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-searchform-test-'));
    cdpPort = 9222 + Math.floor(Math.random() * 5000);
    chromeProc = launchChrome({ userDataDir, cdpPort, startUrl: `http://127.0.0.1:${serverPort}/` });
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

  it('searchCategory selects the category, submits, and parses every result row', async () => {
    currentRows = [
      { id: '2026_EB_705493_1', title: 'AMC for Energy Software', ref: 'CE/IT-11/2026-27', category: 'Information Technology', value: 'NA' },
    ];
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/`);

    const rows = await searchCategory(page, 'Information Technology', '21/09/2026');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      serialNo: '1.',
      tenderId: '2026_EB_705493_1',
      title: 'AMC for Energy Software',
      referenceNumber: 'CE/IT-11/2026-27',
      productCategory: 'Information Technology',
      valueInRupees: 'NA',
    });
  });

  it('searchCategory returns an empty array when there are zero results', async () => {
    currentRows = [];
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/`);

    const rows = await searchCategory(page, 'Information Technology', '21/09/2026');

    expect(rows).toEqual([]);
  });

  it('favoriteAllVisibleRows checks every row and submits without a validation alert', async () => {
    currentRows = [
      { id: 'id-1', title: 't1', ref: 'ref-1', category: 'Information Technology', value: 'NA' },
      { id: 'id-2', title: 't2', ref: 'ref-2', category: 'Information Technology', value: 'NA' },
    ];
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/results`);

    let dialogSeen = false;
    page.on('dialog', () => {
      dialogSeen = true;
    });

    const count = await favoriteAllVisibleRows(page);

    expect(count).toBe(2);
    expect(dialogSeen).toBe(false);
    expect(page.url()).toContain('/favorited');
  });

  it('favoriteAllVisibleRows returns 0 and does not submit when there are no rows', async () => {
    currentRows = [];
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/results`);

    const count = await favoriteAllVisibleRows(page);

    expect(count).toBe(0);
    expect(page.url()).not.toContain('/favorited');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/browser/searchFormController.test.ts`
Expected: FAIL — cannot find module `../../src/browser/searchFormController.js`.

- [ ] **Step 3: Write the implementation**

```ts
/// <reference lib="dom" />
// src/browser/searchFormController.ts
import type { Page, Dialog } from 'playwright-core';
import { parseActiveTenderRow, type ParsedActiveTenderRow } from '../search/activeTenderRowParser.js';

/**
 * Runs one category's search: clicks back to Search Active Tenders (a real
 * click -- consistent with never navigating directly to a portal URL),
 * selects the category, sets Date Criteria to Published Date with both
 * From/To set to the given date (the fromDate/toDate inputs are readonly,
 * JS-calendar-driven fields -- confirmed live 2026-09-21 -- so their value
 * is set directly via evaluate() rather than fill(), which Playwright
 * refuses on a readonly element), submits, and parses every result row.
 */
export async function searchCategory(
  page: Page,
  productCategory: string,
  fromToDateDdMmYyyy: string
): Promise<ParsedActiveTenderRow[]> {
  await page.click('text=Search Active Tenders');
  await page.waitForSelector('#ProductCategory');
  await page.selectOption('#ProductCategory', { label: productCategory });
  await page.selectOption('#dateCriteria', { label: 'Published Date' });
  await page.evaluate((date) => {
    const from = document.getElementById('fromDate') as HTMLInputElement | null;
    const to = document.getElementById('toDate') as HTMLInputElement | null;
    if (from) from.value = date;
    if (to) to.value = date;
  }, fromToDateDdMmYyyy);

  await page.click('#submit');
  await page.waitForLoadState('load').catch(() => {});

  const cellRows = await page.evaluate(() => {
    const headerRow = Array.from(document.querySelectorAll('tr')).find(
      (tr) => tr.innerText.includes('Tender ID') && tr.innerText.includes('Favorite')
    );
    const table = headerRow?.closest('table');
    if (!table) return [] as string[][];
    return Array.from(table.querySelectorAll('tr'))
      .slice(1) // skip the header row
      .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? ''))
      .filter((cells) => cells.length >= 6 && cells[1].trim() !== '');
  });

  return cellRows.map(parseActiveTenderRow).filter((r): r is ParsedActiveTenderRow => r !== null);
}

/**
 * Checks every Favorite checkbox currently on the results page and clicks
 * "Set Open Tender as Favorite" once, submitting all of them as a batch --
 * the real portal's own validation script (checkConformSaveDocuments,
 * captured live 2026-09-21) counts ALL checked boxes in the form, not just
 * one, confirming this is the intended usage rather than a per-row submit.
 * Its only native alert() paths fire when NOTHING is checked, so this never
 * triggers one as long as there's at least one row -- a defensive dialog
 * handler is still registered in case a checkbox click silently fails to
 * register (observed as a real, if rare, failure mode elsewhere in this
 * codebase's live testing).
 */
export async function favoriteAllVisibleRows(page: Page): Promise<number> {
  const checkboxes = page.locator('input[type=checkbox]');
  const count = await checkboxes.count();
  if (count === 0) return 0;

  for (let i = 0; i < count; i += 1) {
    await checkboxes.nth(i).check({ force: true }).catch(() => {});
  }

  const onDialog = (dialog: Dialog) => {
    void dialog.dismiss();
  };
  page.on('dialog', onDialog);
  await page.click('#save');
  await page.waitForLoadState('load').catch(() => {});
  page.off('dialog', onDialog);

  return count;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/browser/searchFormController.test.ts`
Expected: 4 passed. (Skipped instead if no Chrome install, matching every other real-Chrome suite.)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all passing, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/browser/searchFormController.ts tests/browser/searchFormController.test.ts
git commit -m "feat: search-form and favorite-button browser controller"
```

---

### Task 5: `runSearchPhase` orchestration + `AuthJobUpdate.phase`

**Files:**
- Modify: `src/orchestration/authJobRunner.ts`
- Create: `src/orchestration/searchPhaseRunner.ts`
- Test: `tests/orchestration/searchPhaseRunner.test.ts`
- Modify: `tests/orchestration/authJobRunner.test.ts`

**Interfaces:**
- Consumes: `searchCategory`/`favoriteAllVisibleRows` (Task 4, `src/browser/searchFormController.js`), `CONFIGURED_SEARCHES` (Task 1, `src/search/searchConfig.js`), `SearchRepository` (`src/persistence/repositories/searchRepository.js`, unmodified), `TenderRepository` (Task 2, `src/persistence/repositories/tenderRepository.js`).
- Produces: `AuthJobUpdate` gains an optional `phase?: 'AUTH' | 'SEARCH'` field (existing callers/tests unaffected -- see Step 1). `runAuthJob` gains an optional 5th parameter `onAttached?: (page: Page) => void`, called once right after the browser attaches, before the polling loop -- existing callers that omit it are unaffected. `interface SearchPhaseDeps { jobs: JobRepository; sessions: AuthSessionRepository; jobMachine: JobStateMachine; searches: SearchRepository; tenders: TenderRepository }`; `function runSearchPhase(deps: SearchPhaseDeps, page: Page, jobId: string, authSessionId: string, onUpdate: (update: AuthJobUpdate) => void): Promise<AuthJobUpdate>`. Task 6's `start-job` IPC handler calls both `onAttached` and `runSearchPhase` directly.

- [ ] **Step 1: Add `phase` to `AuthJobUpdate` and `onAttached` to `runAuthJob`, confirm existing tests still pass**

In `src/orchestration/authJobRunner.ts`, add `import type { Page } from 'playwright-core';` to the top of the file, then change the `AuthJobUpdate` interface to:

```ts
export interface AuthJobUpdate {
  jobId: string;
  authSessionId: string;
  jobState: JobState;
  authState: AuthState;
  outcome?: 'SUCCESS' | 'TIMEOUT' | 'ABORTED';
  abortReason?: string;
  phase?: 'AUTH' | 'SEARCH';
}
```

Change the `runAuthJob` function signature to accept the new optional parameter, and call it right after `attachResult`/`authSessionId` are known:

```ts
export async function runAuthJob(
  deps: AuthJobRunnerDeps,
  cdpEndpoint: string,
  portalUrl: string,
  onUpdate: (update: AuthJobUpdate) => void,
  onAttached?: (page: Page) => void
): Promise<AuthJobUpdate> {
```

(Leave every other line of the function body exactly as-is, except adding one call right after `const { authSessionId } = attachResult.value;`:)

```ts
  const { authSessionId } = attachResult.value;
  onAttached?.(flow.getPage());
  jobMachine.transition(job.id, 'AUTH_PENDING', 'browser attached');
```

Run: `npm test -- tests/orchestration/authJobRunner.test.ts`
Expected: 3 passed, unchanged -- this step is purely additive (an optional field, an optional parameter with a no-op default), and confirms that before writing anything new.

- [ ] **Step 2: Write the failing search-phase tests**

```ts
// tests/orchestration/searchPhaseRunner.test.ts
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
import { SearchRepository } from '../../src/persistence/repositories/searchRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { JobStateMachine } from '../../src/state/jobStateMachine.js';
import { AuthStateMachine } from '../../src/state/authStateMachine.js';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { runSearchPhase } from '../../src/orchestration/searchPhaseRunner.js';
import type { AuthJobUpdate } from '../../src/orchestration/authJobRunner.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

function resultsHtml(category: string): string {
  const isTarget = category === 'Information Technology';
  const row = isTarget
    ? `<tr>
        <td>1.</td><td>tender-${category}</td><td>Title for ${category}</td>
        <td>ref-${category}</td><td>${category}</td><td>NA</td>
        <td><input type="checkbox" name="Checkbox" id="Checkbox"></td>
      </tr>`
    : '';
  return `<html><body>
    <a href="/">Search Active Tenders</a>
    <form id="activeTenders" action="/favorited" method="post">
      <table>
        <tr><td>S.No</td><td>Tender ID</td><td>Tender Title</td><td>Tender Reference Number</td><td>Product Category</td><td>Value in Rs</td><td>Favorite</td></tr>
        ${row}
      </table>
      <script>
        function checkConformSaveDocuments(f1, cname) {
          var f = document.getElementById(f1);
          var countf = 0, counti = 0;
          for (var i = 0; i < f.elements.length; i++) {
            if (f.elements[i].type === 'checkbox') { counti++; if (f.elements[i].checked) countf++; }
          }
          if (countf <= 0) { alert('none selected'); return false; }
          return true;
        }
      </script>
      <input type="submit" id="save" value="Set Open Tender as Favorite" onclick="return checkConformSaveDocuments('activeTenders','tender');">
    </form>
  </body></html>`;
}

const SEARCH_FORM_HTML = `<html><body>
  <a href="/results">Search Active Tenders</a>
  <select id="ProductCategory">
    <option value="">-Select-</option>
    <option>Computer- S/W</option>
    <option>Information Technology</option>
    <option>Info. Tech. Services</option>
    <option>Documentary film,Video film</option>
    <option>Miscellaneous Goods</option>
    <option>Miscellaneous Services</option>
    <option>Miscellaneous Works</option>
  </select>
  <select id="dateCriteria"><option value="0">-Select-</option><option value="1">Published Date</option></select>
  <input type="text" name="fromDate" id="fromDate" readonly value="">
  <input type="text" name="toDate" id="toDate" readonly value="">
  <input type="submit" id="submit" value="Search" onclick="document.location.href='/results?category=' + encodeURIComponent(document.getElementById('ProductCategory').value)">
</body></html>`;

describe.skipIf(!CHROME_PATH)('runSearchPhase', { timeout: 30_000 }, () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let sessions: AuthSessionRepository;
  let jobMachine: JobStateMachine;
  let authMachine: AuthStateMachine;
  let searches: SearchRepository;
  let tenders: TenderRepository;
  let jobId: string;
  let authSessionId: string;
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
    jobMachine = new JobStateMachine(db, jobs, transitions);
    authMachine = new AuthStateMachine(db, sessions, transitions);
    searches = new SearchRepository(db);
    tenders = new TenderRepository(db);

    const job = jobs.create();
    jobId = job.id;
    jobMachine.transition(jobId, 'AUTH_REQUIRED', 'test setup');
    jobMachine.transition(jobId, 'AUTH_PENDING', 'test setup');
    jobMachine.transition(jobId, 'AUTHENTICATED', 'test setup');
    const session = sessions.create(jobId);
    authSessionId = session.id;
    authMachine.transition(authSessionId, 'AUTH_PENDING', 'test setup');
    authMachine.transition(authSessionId, 'AUTHENTICATED', 'test setup');

    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/results')) {
        const url = new URL(req.url, 'http://localhost');
        res.end(resultsHtml(decodeURIComponent(url.searchParams.get('category') ?? '')));
      } else if (req.url?.startsWith('/favorited')) {
        res.end('<html><body>Favorited. <a href="/">Search Active Tenders</a></body></html>');
      } else {
        res.end(SEARCH_FORM_HTML);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as { port: number }).port;

    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-searchphase-test-'));
    cdpPort = 9222 + Math.floor(Math.random() * 5000);
    chromeProc = launchChrome({ userDataDir, cdpPort, startUrl: `http://127.0.0.1:${serverPort}/` });
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

  it('runs all 7 searches, favorites the one matching category, and lands the job in CLASSIFYING', async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/`);

    const updates: AuthJobUpdate[] = [];
    const result = await runSearchPhase(
      { jobs, sessions, jobMachine, searches, tenders },
      page,
      jobId,
      authSessionId,
      (u) => updates.push(u)
    );

    expect(result.outcome).toBe('SUCCESS');
    expect(result.phase).toBe('SEARCH');
    expect(result.jobState).toBe('CLASSIFYING');
    expect(jobs.getById(jobId)!.state).toBe('CLASSIFYING');

    const allSearches = searches.listForJob(jobId);
    expect(allSearches).toHaveLength(7);
    expect(allSearches.every((s) => s.state === 'COMPLETE')).toBe(true);

    const allTenders = tenders.listForJob(jobId);
    expect(allTenders).toHaveLength(1);
    expect(allTenders[0].tender_ref).toBe('ref-Information Technology');
    expect(allTenders[0].favorited).toBe(1);
    expect(allTenders[0].favorited_at).not.toBeNull();

    expect(updates.at(-1)?.outcome).toBe('SUCCESS');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/orchestration/searchPhaseRunner.test.ts`
Expected: FAIL — cannot find module `../../src/orchestration/searchPhaseRunner.js`.

- [ ] **Step 4: Write the implementation**

```ts
// src/orchestration/searchPhaseRunner.ts
import type { Page } from 'playwright-core';
import type { JobRepository } from '../persistence/repositories/jobRepository.js';
import type { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';
import type { SearchRepository } from '../persistence/repositories/searchRepository.js';
import type { TenderRepository } from '../persistence/repositories/tenderRepository.js';
import { CONFIGURED_SEARCHES } from '../search/searchConfig.js';
import { searchCategory, favoriteAllVisibleRows } from '../browser/searchFormController.js';
import type { AuthJobUpdate } from './authJobRunner.js';

export interface SearchPhaseDeps {
  jobs: JobRepository;
  sessions: AuthSessionRepository;
  jobMachine: JobStateMachine;
  searches: SearchRepository;
  tenders: TenderRepository;
}

function formatDdMmYyyy(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function runSearchPhase(
  deps: SearchPhaseDeps,
  page: Page,
  jobId: string,
  authSessionId: string,
  onUpdate: (update: AuthJobUpdate) => void
): Promise<AuthJobUpdate> {
  const { jobs, sessions, jobMachine, searches, tenders } = deps;

  jobMachine.transition(jobId, 'SEARCHING', 'search phase started');

  const snapshot = (outcome?: 'SUCCESS' | 'ABORTED', abortReason?: string): AuthJobUpdate => ({
    jobId,
    authSessionId,
    jobState: jobs.getById(jobId)!.state,
    authState: sessions.getById(authSessionId)!.state,
    outcome,
    abortReason,
    phase: 'SEARCH',
  });

  onUpdate(snapshot());

  const today = formatDdMmYyyy(new Date());

  for (const config of CONFIGURED_SEARCHES) {
    const existing = searches.findByJobAndKey(jobId, config.searchKey);
    const search = existing ?? searches.create(jobId, config.searchKey, config.productCategory);
    if (search.state === 'COMPLETE') continue;

    searches.updateState(search.id, 'RUNNING');

    try {
      const rows = await searchCategory(page, config.productCategory, today);

      for (const row of rows) {
        tenders.upsert({
          jobId,
          tenderRef: row.referenceNumber,
          tenderPortalId: row.tenderId,
          title: row.title,
          organisationChain: null,
          publishedDate: null,
          closingDate: null,
          openingDate: null,
          productCategory: row.productCategory,
          valueInRupees: row.valueInRupees,
        });
      }

      if (rows.length > 0) {
        await favoriteAllVisibleRows(page);
        const favoritedAt = new Date().toISOString();
        for (const row of rows) {
          const tender = tenders.findByJobAndRef(jobId, row.referenceNumber);
          if (tender) tenders.markFavorited(tender.id, favoritedAt);
        }
      }

      searches.updateProgress(search.id, 0, rows.length);
      searches.updateState(search.id, 'COMPLETE');
    } catch (err) {
      searches.updateState(search.id, 'INTERRUPTED');
      const authState = sessions.getById(authSessionId)!.state;
      if (authState === 'TAB_LOST' || authState === 'SESSION_EXPIRED') {
        const final = snapshot(
          'ABORTED',
          `auth session reached terminal state ${authState} during ${config.productCategory} search`
        );
        onUpdate(final);
        return final;
      }
      // This one category failed for a reason unrelated to the session
      // being lost (e.g. a page-structure surprise) -- the master prompt's
      // own per-category resilience: move on to the next category rather
      // than aborting the whole phase.
    }

    onUpdate(snapshot());
  }

  jobMachine.transition(jobId, 'CLASSIFYING', 'all category searches complete');
  const final = snapshot('SUCCESS');
  onUpdate(final);
  return final;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/orchestration/searchPhaseRunner.test.ts`
Expected: 1 passed.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run build && npm run typecheck`
Expected: all passing, build clean, typecheck clean on both configs.

- [ ] **Step 7: Commit**

```bash
git add src/orchestration/authJobRunner.ts src/orchestration/searchPhaseRunner.ts tests/orchestration/authJobRunner.test.ts tests/orchestration/searchPhaseRunner.test.ts
git commit -m "feat: runSearchPhase orchestration, chained after a successful auth via AuthJobUpdate.phase"
```

---

### Task 6: Wire the search phase into `start-job`

**Files:**
- Modify: `src/electron/main.ts`
- Modify: `renderer/src/App.tsx`

**Interfaces:**
- Consumes: `runSearchPhase`/`SearchPhaseDeps` (Task 5, `src/orchestration/searchPhaseRunner.js`), `onAttached` param on `runAuthJob` (Task 5), `SearchRepository`/`TenderRepository` (existing/Task 2).
- Produces: `start-job`'s existing `{ jobId: string }` return shape is unchanged; the job now continues automatically through the search phase before Chrome is released. `App.tsx`'s `activeJobId` tracking now stays "running" through both phases.

No automated tests for this task (Electron main-process wiring, consistent with every prior Electron-shell task in this project) — verified manually in Task 8.

- [ ] **Step 1: Construct the new repositories and wire `onAttached` + phase-chaining in `main.ts`**

Add these imports to the top of `src/electron/main.ts` (alongside the existing ones):

```ts
import { SearchRepository } from '../persistence/repositories/searchRepository.js';
import { TenderRepository } from '../persistence/repositories/tenderRepository.js';
import { runSearchPhase } from '../orchestration/searchPhaseRunner.js';
```

Add these two lines alongside the existing repository construction (after `const transitions = new StateTransitionRepository(db);`):

```ts
const searches = new SearchRepository(db);
const tenders = new TenderRepository(db);
```

Add `import type { Page } from 'playwright-core';` to the top of `main.ts`, alongside the other imports.

Replace the `start-job` handler's body from `const runPromise = runAuthJob(` through the end of the handler with:

```ts
  let capturedPage: Page | undefined;

  const runPromise = runAuthJob(
    { jobs, sessions, jobMachine, authMachine },
    `http://127.0.0.1:${cdpPort}`,
    PORTAL_URL,
    (update) => {
      if (!jobIdCaptured) {
        jobIdCaptured = true;
        activeJobId = update.jobId;
        resolveStarted(update.jobId);
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('job-updated', update);
    },
    (page) => {
      capturedPage = page;
    }
  ).then(async (authResult) => {
    if (authResult.outcome !== 'SUCCESS' || !capturedPage) return authResult;

    return runSearchPhase(
      { jobs, sessions, jobMachine, searches, tenders },
      capturedPage,
      authResult.jobId,
      authResult.authSessionId,
      (update) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('job-updated', update);
      }
    );
  });
```

The rest of the handler (the `runPromise.catch(...)` and `.finally(...)` blocks, and `const jobId = await started; return { jobId };`) stays exactly as it is today — `.finally()`'s Chrome-kill now naturally fires only after BOTH phases settle, since `runPromise` itself now resolves only once the chained `runSearchPhase` call (when reached) also finishes.

- [ ] **Step 2: Update `App.tsx`'s "is a job still running" logic**

In `renderer/src/App.tsx`, replace the `onJobUpdate` callback body:

```ts
    const unsubscribe = window.tenderAssist.onJobUpdate((update) => {
      setActiveJobId(update.outcome ? null : update.jobId);
    });
```

with:

```ts
    const unsubscribe = window.tenderAssist.onJobUpdate((update) => {
      // The auth phase's own SUCCESS is no longer the end of the run -- the
      // search phase continues automatically on the same job. Only treat
      // the run as over on a genuine failure (any phase), or the search
      // phase's own terminal SUCCESS (phase: 'SEARCH').
      const runOver =
        update.outcome === 'TIMEOUT' ||
        update.outcome === 'ABORTED' ||
        (update.outcome === 'SUCCESS' && update.phase === 'SEARCH');
      setActiveJobId(runOver ? null : update.jobId);
    });
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: clean on all three configs.

- [ ] **Step 4: Commit**

```bash
git add src/electron/main.ts renderer/src/App.tsx
git commit -m "feat: chain the search phase after a successful auth in start-job"
```

---

### Task 7: Show tenders found on the Job Detail screen

**Files:**
- Modify: `src/electron/ipcTypes.ts`
- Modify: `src/electron/main.ts`
- Modify: `renderer/src/components/JobDetail.tsx`

**Interfaces:**
- Consumes: `TenderRow`/`SearchRow` (existing repositories, Task 2 for the new `TenderRow` fields).
- Produces: `JobDetail` (the IPC type) gains `tenders: TenderRow[]` and `searches: SearchRow[]`. No new IPC channel — reuses the existing `get-job-detail` handler and `job-updated` push (already re-fetches full detail on every update, so this "just works" once the fields exist).

No automated tests for this task (renderer/IPC shell code, consistent with every prior task of this shape) — verified manually in Task 8.

- [ ] **Step 1: Extend the `JobDetail` IPC type**

In `src/electron/ipcTypes.ts`, add these imports alongside the existing ones:

```ts
import type { TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { SearchRow } from '../persistence/repositories/searchRepository.js';
```

Add `tenders` and `searches` to the `JobDetail` interface:

```ts
export interface JobDetail {
  jobId: string;
  jobState: JobState;
  authSessionId: string | null;
  authState: AuthState | null;
  jobTransitions: StateTransitionRow[];
  authTransitions: StateTransitionRow[];
  tenders: TenderRow[];
  searches: SearchRow[];
}
```

- [ ] **Step 2: Populate the new fields in `get-job-detail`**

In `src/electron/main.ts`, the `get-job-detail` handler currently returns an object literal — add two fields to it:

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
    tenders: tenders.listForJob(jobId),
    searches: searches.listForJob(jobId),
  };
});
```

(`tenders`/`searches` repository instances already exist in this module from Task 6 Step 1.)

- [ ] **Step 3: Render a "Tenders found" section on the Job Detail screen**

In `renderer/src/components/JobDetail.tsx`, add this new section right after the closing `</div>` of `detail-columns` (i.e. as a sibling after the two-column transitions block, still inside the outer `<div>`):

```tsx
      {detail.tenders.length > 0 && (
        <div>
          <h2>Tenders found ({detail.tenders.length})</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tender ID</th>
                <th>Title</th>
                <th>Category</th>
                <th>Value (₹)</th>
                <th>Favorited</th>
              </tr>
            </thead>
            <tbody>
              {detail.tenders.map((t) => (
                <tr key={t.id}>
                  <td className="job-id">{t.tender_portal_id ?? t.tender_ref}</td>
                  <td>{t.title}</td>
                  <td>{t.product_category}</td>
                  <td>{t.value_in_rupees}</td>
                  <td>{t.favorited ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: clean on all three configs.

- [ ] **Step 5: Commit**

```bash
git add src/electron/ipcTypes.ts src/electron/main.ts renderer/src/components/JobDetail.tsx
git commit -m "feat: show tenders found and favorited on the Job Detail screen"
```

---

### Task 8: Final end-to-end verification pass

**Files:** none (verification only; fix forward in the relevant file from Tasks 1-7 if this surfaces a real bug).

- [ ] **Step 1: Run the full automated suite, build, and typecheck**

Run: `npm test && npm run build && npm run typecheck`
Expected: all tests passing (138 from Task 1 alone, plus every new test from Tasks 2-5 — confirm the exact final count when you run it), build clean, typecheck clean on all three configs.

- [ ] **Step 2: Manual end-to-end walkthrough against the real portal**

Run `npm run electron`. Click "Start new job", complete DSC login as before. Expected, in order:
1. The job reaches `AUTHENTICATED` exactly as it does today.
2. Without any further human input, the job's state moves to `SEARCHING`, and the Job Detail screen's "Job transitions" timeline grows with each category's progress.
3. Within a few minutes (7 real searches against the live portal), the job reaches `CLASSIFYING`. The outcome banner shows `SUCCESS`.
4. The new "Tenders found" table on Job Detail lists every tender found across all 7 categories, with a real Value and Favorited = Yes for each.
5. On the real TN Tenders portal (in the Chrome window, before it closes, or by checking "My Tenders" in a fresh session afterward), confirm the tenders shown really were favorited.
6. Confirm the "Start new job" button stays disabled ("Job running…") throughout steps 2-3, and re-enables only once `CLASSIFYING` is reached.

- [ ] **Step 3: Cross-check the database directly**

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const dbPath = path.join(process.env.APPDATA, 'TenderAssist', 'tenderassist.db');
const db = new DatabaseSync(dbPath);
const job = db.prepare('SELECT id, state FROM jobs ORDER BY created_at DESC LIMIT 1').get();
console.log('job:', job);
console.log('searches:', db.prepare('SELECT search_key, product_category, state, result_count FROM searches WHERE job_id = ? ORDER BY search_key').all(job.id));
console.log('tenders:', db.prepare('SELECT tender_ref, product_category, value_in_rupees, favorited FROM tenders WHERE job_id = ?').all(job.id));
db.close();
"
```

Expected: `job.state` is `CLASSIFYING`, all 7 `searches` rows show `state: 'COMPLETE'`, and every `tenders` row shows `favorited: 1`.

- [ ] **Step 4: Fix forward if anything surfaced**

If Step 2 or 3 reveals a real defect (e.g. the date-picker fields behave differently than captured, or pagination shows up on a category with many results and isn't handled), fix it in the relevant file from Tasks 1-7, re-run the affected automated tests plus Step 1's full suite, and repeat the manual walkthrough once more before proceeding. If everything already worked, there is nothing to do here.

- [ ] **Step 5: Commit (only if Step 4 made changes)**

```bash
git add -A
git commit -m "fix: address issue found during search-execution end-to-end verification"
```

(Skip this step entirely if Step 4 found nothing to fix.)

## Self-Review Notes

- **Spec coverage:** the category-list fix (Task 1), the real results-table parser (Task 3), the search-form/favorite browser controller (Task 4), the new `tenders` columns (Task 2), the orchestration function and its chaining after auth (Tasks 5-6), and the Job Detail UI surface (Task 7) each map to a section of `docs/superpowers/specs/2026-09-21-search-execution-design.md`. The two items the spec explicitly left open (exact date-picker field names, real pagination markup) are resolved: the date fields (`fromDate`/`toDate`) were captured live before writing this plan (Task 4); pagination is still unconfirmed and is called out explicitly in Task 8 Step 4 as something to fix forward if it surfaces during the real walkthrough, rather than silently assumed away.
- **Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code.
- **Type consistency:** `ParsedActiveTenderRow` (Task 3) is consumed by `searchFormController.ts` (Task 4) and never redefined; `AuthJobUpdate.phase` (Task 5) is the one new field threaded through `searchPhaseRunner.ts`, `main.ts`, and `App.tsx` (Task 6) with the same literal union type throughout; `SearchPhaseDeps` (Task 5) matches exactly what `main.ts` constructs and passes in Task 6.

## Next Milestone

Not yet planned: detail-page extraction and the four hard gates (freshness/category/hardware/maintenance exclusion) — the next sub-project from the search-execution design spec's decomposition, once this milestone's tenders are confirmed landing correctly in `CLASSIFYING`.
