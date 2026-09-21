# TenderAssist Search Execution — Design (Search + Review + Favorite Milestone)

**Status:** Approved design, pending implementation plan.

**Context:** The Electron dashboard auth-flow milestone (2026-09-18 spec, Plans 1-6/Task 7) is complete and validated end-to-end against the real portal: a job reliably reaches `AUTHENTICATED` and stays there. This is the next milestone: once a job is authenticated, automatically continue into the portal's own **Search Active Tenders** flow — search all 7 configured category/product combinations, collect every result row, and mark each one as a Favorite on the real portal — matching the first half of the production "master scheduler prompt" (an independent, already-running Claude-in-Chrome agent; see `MEMORY.md`'s `project-real-production-direction` note). This spec's job is to reproduce that same behavior as deterministic, testable TypeScript code, not to replace or coordinate with that agent.

Some backend groundwork already exists from Plan 5 (`src/search/`, `src/classification/`, the `searches`/`tenders` tables) but was built without a live capture of the actual Search Active Tenders page, and turned out not to match it (see "Corrections to Plan 5" below) — confirmed today by connecting to a real authenticated session and capturing the real form and results-table markup.

## Goals

- After a job reaches `AUTHENTICATED`, automatically transition through `SEARCHING` and run all 7 category searches without further human input.
- Parse each search's real results table (`S.No | Tender ID | Tender Title | Tender Reference Number | Product Category | Value in ₹ | Favorite`) and persist every row, de-duplicated by Tender ID across categories.
- Favorite every result row on the real portal (checkbox + "Set Open Tender as Favorite"), matching the master prompt's requirement that this must happen even though the four exclusion gates haven't run yet — some favorited tenders will later get excluded, which is expected.
- Land the job in `CLASSIFYING` once all 7 searches are done, ready for the next milestone (detail extraction + the four gates) to pick up.

## Non-goals (explicitly out of scope for this milestone)

- Detail-page extraction and the four hard gates (freshness/category/hardware/maintenance) — next milestone. `CLASSIFYING` is a resting state here, not implemented behavior.
- Document download, Drive archival, OCR, and the three CSV/report outputs — later milestones.
- Pagination handling beyond a defensive best-effort — no category search produced more than one page of results during live verification, so the real pagination markup is unconfirmed (see Open Questions).
- Any change to the "My Tenders" screen or the tender detail popup/page — those belong to the next milestone.

## Corrections to Plan 5 (confirmed via a live authenticated capture, 2026-09-21)

- **`src/search/searchConfig.ts`** lists `Computer- H/W` (hardware — explicitly out of scope per the production categories) and is missing `Documentary film,Video film`. Both confirmed live against the real `#ProductCategory` dropdown (94 options; all 7 target values exist verbatim, including `Computer- H/W` as a distinct, separate option from `Computer- S/W`). Fix: swap it for `Documentary film,Video film`.
- **`src/search/tenderRowParser.ts`** expects cells shaped `[_, ePublishedDate, closingDate, openingDate, titleCell, organisationChainCell]` with a bracket-embedded `[Title] [RefNo][PortalId]` pattern. The real Search Active Tenders results table has none of this — no dates, no bracket-embedded title, and a completely different 7-column shape (below). This parser was evidently built for a different page. It's left untouched (it may still be correct for whatever it was actually built against) — this milestone adds a new, separately-named parser rather than repurposing it.
- **`src/persistence/migrations/004_tenders.sql`** (`tenders` table) has `published_date`/`closing_date`/`opening_date` columns that don't correspond to anything in this results table, and no column for the Value or Favorite-status data the table *does* provide. Needs a follow-on migration (see Data Model below) rather than reuse as-is.
- **`src/persistence/repositories/searchRepository.ts`** (`SearchRepository`, `searches` table) matches this milestone's needs as designed — per-category state (`PENDING/RUNNING/PAGINATING/COMPLETE/INTERRUPTED`) and pagination progress tracking — and is reused unchanged. Its `updateState` docstring already says "Use through the search-execution orchestrator (Plan 6) once it exists," which is exactly this milestone.
- **`src/classification/gate1Freshness.ts`, `gate2ProductCategory.ts`** are generic pure functions with no page-shape assumptions baked in; unaffected either way, and out of scope for this milestone regardless (next milestone's concern).

## Real portal markup (captured 2026-09-21 against an authenticated session)

Search form (`Bid Management → Search Active Tenders`): `<select id="ProductCategory">`, `<select id="dateCriteria">` (option text `"Published Date"`), a date-range picker pair (exact field names to be confirmed during implementation — the picker widgets default to today's date), `<input type="submit" id="submit" value="Search">`.

Results table (one row shown; header row confirmed even when only one category was searched):

```html
<table id="tabList_1" ...>
  <tr>
    <td class="list_col">S.No</td>
    <td class="list_col">Tender ID</td>
    <td class="list_col">Tender Title</td>
    <td class="list_col">Tender Reference Number</td>
    <td class="list_col">Product Category</td>
    <td class="list_col">Value in ₹ </td>
    <td class="list_col">Favorite</td>
  </tr>
  <tr id="informal_22" class="even">
    <td>1.</td>
    <td>2026_EB_705493_1</td>
    <td>AMC for Open Access Energy Adjustment and Accounting Software...</td>
    <td>CE/IT and RAPDRP-11/2026-27</td>
    <td>Information Technology</td>
    <td align="right">NA</td>
    <td>
      <input type="checkbox" name="Checkbox" id="Checkbox" title="Select Favorite">
      <a onclick="return openPopUp(this, '...');" href="/nicgep/app?...&amp;sp=...">
        <img title="View Tender Information">
      </a>
    </td>
  </tr>
</table>
```

Important, confirmed properties:
- The row's `id` (`informal_22`) is a positional/generated value, not a stable per-tender identifier — never rely on it across renders.
- The Favorite `<input>`'s `id`/`name` (`Checkbox`) is **not unique per row** — every row uses the same id/name. Checkboxes must be selected relative to their own row (e.g. `row.locator('input[type=checkbox]')`), never by id/name directly.
- The "View Tender Information" icon (`<img title="View Tender Information">`) really does open an untracked popup window via `onclick="openPopUp(...)"`, and its `href` really does carry an `sp=`-tokenized query param — confirms the master prompt's warning applies here too. This milestone never clicks it.
- Favoriting is a two-step action: check the row's box, then click a page-level `<input id="save" value="Set Open Tender as Favorite" onclick="return checkConformSaveDocuments('activeTenders','tender');">`. Read `checkConformSaveDocuments`'s actual source live: it only calls `alert()` (a blocking native dialog) when *no* checkbox is checked at all — `"Please select atleast one tender"` or `"No documents available"`. As long as automation always checks a box before clicking `#save`, no dialog fires. A defensive `page.on('dialog')` auto-dismiss handler is still added, matching this repo's existing "retry, don't trust a single click" posture (today's live testing hit two separate cases of a click silently not registering).

## Architecture

```
runAuthJob() resolves SUCCESS
        │
        ▼
runSearchPhase(deps, page, jobId)   [NEW — src/orchestration/searchPhaseRunner.ts]
        │  (reuses the SAME retained `page` from AuthFlow.getPage() — no new
        │   Chrome/CDP attach; the profile-lock-releasing Chrome kill in
        │   main.ts's start-job handler moves to after THIS also settles,
        │   not right after auth)
        ▼
for each of CONFIGURED_SEARCHES (7 entries):
    SearchRepository.create/find → state RUNNING
    searchFormController: navigate to Search Active Tenders,
      select category, set date=today, submit
    activeTenderRowParser: parse every result row
    TenderRepository.upsert() each row (de-dupes by tender_ref)
    for each newly-seen row: check its Favorite box + click #save
    SearchRepository.updateState(..., COMPLETE | INTERRUPTED)
        ▼
jobMachine.transition(CLASSIFYING)
```

No server, no HTTP layer — same in-process architecture as every prior milestone. `runSearchPhase` is a new, separately-tested orchestration function following `runAuthJob`'s existing shape (a `deps` object of repositories/state machines, an `onUpdate` callback for live UI updates), not a modification of `runAuthJob` itself — keeps the already-validated auth contract untouched.

### New files

- `src/search/activeTenderRowParser.ts` — `parseActiveTenderRow(cells: string[]): ParsedActiveTenderRow | null`, matching the real 7-column shape above. Named distinctly from Plan 5's `tenderRowParser.ts` (different page, kept separate rather than merged/repurposed).
- `src/browser/searchFormController.ts` — thin Playwright wrapper around one page's worth of interaction: `searchCategory(page, productCategory): Promise<ParsedActiveTenderRow[]>` (navigate, fill, submit, parse table, defensive dialog handler) and `favoriteRow(page, tenderRef): Promise<void>` (locate the row by its Tender ID cell text, check its box, click `#save`, retry on a silent no-op click — same coordinate-click fallback pattern already used in `authJobRunner.ts`/today's manual testing).
- `src/orchestration/searchPhaseRunner.ts` — `runSearchPhase(deps, page, jobId, onUpdate): Promise<SearchPhaseResult>`, the loop above.
- `src/persistence/migrations/005_active_tenders.sql` — see Data Model.

### Modified files

- `src/search/searchConfig.ts` — category-list fix (see Corrections above).
- `src/persistence/repositories/tenderRepository.ts` — extended for the new columns (see Data Model); existing `upsert`/`findByJobAndRef`/`listForJob` shape is kept, not replaced.
- `src/electron/main.ts` — `start-job` handler chains `runSearchPhase` after `runAuthJob` SUCCESS, on the same page, before the Chrome-kill cleanup.
- `src/electron/ipcTypes.ts` / renderer — `AuthJobUpdate`-equivalent updates for the search phase surface on the Job Detail screen (exact shape left to the implementation plan; likely a new `SearchPhaseUpdate` pushed the same way `job-updated` is today).

## Data Model

New migration `005_active_tenders.sql`, additive to the existing `tenders` table rather than a rewrite (the `published_date`/`closing_date`/`opening_date` columns are left in place — unused by this milestone, potentially still meaningful to a future page/parser, not this spec's call to remove):

```sql
ALTER TABLE tenders ADD COLUMN value_in_rupees TEXT;      -- "NA" is a real, valid value
ALTER TABLE tenders ADD COLUMN favorited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenders ADD COLUMN favorited_at TEXT;
```

`TenderRepository.upsert()` keeps its existing find-by-`(job_id, tender_ref)`-first behavior (this is what already gives same-day-rerun safety for free — a tender seen again on a re-run is not re-inserted). A new `TenderRepository.markFavorited(id, favoritedAt)` method records the outcome of the favorite action separately from the row's initial creation, so a row can exist (search found it) without yet being favorited (favorite action hasn't run/failed), matching the real two-step nature of the portal action.

## Error handling

- A single category search failing (form fill error, submit not registering, table not found) does not abort the whole phase — `SearchRepository.updateState(..., 'INTERRUPTED')` and continue to the next category, matching the master prompt's per-category resilience ("zero or few matches on many days is expected, never an error" — and by extension, one category's transient failure shouldn't sink the other six).
- Click-doesn't-register is treated as routine, not exceptional — retry (plain re-click, then coordinate-click) up to 2-3 times before concluding failure, reusing the pattern already proven necessary twice in today's manual auth testing.
- Session loss (`TAB_LOST`/`SESSION_EXPIRED`) during the search phase reuses the existing `reactToAuthSessionLoss` handler and `AuthStateMachine` — no new session-loss semantics, just a new phase where it can occur.
- A favorite action that fails after retries for one specific tender does not block the rest of that category's rows or the next category — logged/reported, not fatal (mirrors the master prompt's per-document/per-tender failure isolation elsewhere in the same spec).

## Testing

- `activeTenderRowParser.ts`: pure-function unit tests against the real captured table HTML above (fixture, not live-scraped each test run) — same style as Plan 5's row-parser tests.
- `searchFormController.ts`: real-Chrome integration tests (`describe.skipIf(!CHROME_PATH)`) against a local fixture HTTP server serving the captured real form/table markup, following the exact pattern `tests/browser/browserController.test.ts` and today's new `authFlow.test.ts` case already established.
- `searchPhaseRunner.ts`: unit/integration tests following `authJobRunner.test.ts`'s pattern — real in-memory SQLite via `runMigrations`, asserting the sequence of `onUpdate` calls and final `searches`/`tenders` table state, not just the return value.
- `TenderRepository`'s new columns/methods: unit tests against in-memory SQLite, following every existing repository test file's pattern in this repo.
- No automated test for the Electron/renderer surface changes, consistent with every prior milestone — verified manually.

## Open questions carried to the implementation plan (not blocking this design)

- The date-range picker fields' exact names/ids weren't captured live (the widgets defaulted to today already, so the search didn't require touching them) — implementation will need one more live check specifically for setting an explicit From/To date, in case a re-run on a later day needs it set deliberately rather than relying on the default.
- Real pagination markup is unconfirmed — only a 1-result page was observed live. The implementation plan should either verify this against a category likely to have multiple pages, or build defensively (check for a "next page" control, do nothing if absent) and flag it for a follow-up check.
- Exact shape of the new `SearchPhaseUpdate` IPC push and how the Job Detail screen renders per-category progress — left to the plan, following whatever shape reads best against `AuthJobUpdate`'s established one.
