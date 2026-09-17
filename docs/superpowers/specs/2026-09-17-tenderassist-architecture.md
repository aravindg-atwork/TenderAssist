# TenderAssist — POC Architecture Spec

**Status:** approved for Phase 0/1 implementation (2026-09-17)
**Source:** full product requirements were provided in conversation (TN Tenders acquisition, relevance classification, document processing, requirement extraction). This document is the technical architecture derived from that spec for the acquisition POC only (Zone A). Zone B (document processing) and Zone C (cloud/AI/reporting) are out of scope until the POC in this document passes.

## Product boundary (non-negotiable)

TenderAssist never decides bid eligibility. It discovers tenders, classifies relevance, acquires documents, and extracts requirements as structured evidence with `human_status: UNANSWERED`. A human always makes the go/no-go call.

## Technology stack

- **Shell:** Electron (main process hosts the orchestrator; renderer is a two-screen customer UI). Deferred until the UI-integration phase — not needed for Phase 0/1.
- **Browser automation:** Playwright, attached via `chromium.connectOverCDP` to a real, locally-installed Chrome (not Playwright's bundled Chromium, not headless). Chrome is launched with a dedicated `--user-data-dir` and `--remote-debugging-port`. Reason: TN Tenders DSC signing depends on a local signer service/extension bound to the user's real Chrome installation; a bundled/headless browser is unlikely to have it. This is an **unvalidated assumption** — see Unknowns.
- **Persistence:** SQLite via Node's built-in `node:sqlite` (`DatabaseSync`), WAL mode, single file under the app data directory. Chosen for zero external service dependency, transactional writes, and survival across restarts. **Revised 2026-09-17:** originally planned as `better-sqlite3`, but that requires a native compile (node-gyp + Visual Studio Build Tools) and this dev machine's Node version (26.3.0) has no prebuilt binary — the build failed outright. Since the product's core UX principle is that a non-technical customer's machine must never need a C++ toolchain either, `node:sqlite` (built into Node itself, verified working with no native dependency) replaces it project-wide. API differences from `better-sqlite3`: no `.pragma()` (use `db.exec('PRAGMA ...')`), no `.transaction(fn)` helper (wrap in `db.exec('BEGIN')` / `COMMIT` / `ROLLBACK` manually), rows come back as null-prototype objects (harmless for Vitest's `toEqual`, which ignores prototype).
- **Document processing (Zone B, later):** pdfjs-dist/pdf-parse for native text, pdf-lib/poppler for rasterizing scanned pages, Tesseract.js or a cloud OCR API for OCR, exceljs/xlsx for BOQ spreadsheets.
- **Semantic model (Zone A gates G3/G4, and Zone C extraction later):** Claude (Sonnet 5) via the Anthropic API, behind a `SemanticModelProvider` interface, structured output validated with `zod`.
- **Cloud storage/report (Zone C, later):** Google Drive API v3 resumable upload, Google Sheets API v4.
- **Scheduling:** `node-cron` inside the resident Electron tray app (deferred to UI-integration phase).
- **Test framework:** Vitest.

## State model

**Job:** `SCHEDULED → AUTH_REQUIRED → AUTH_PENDING → AUTHENTICATED → SEARCHING → CLASSIFYING → SHORTLISTED → ACQUIRING_DOCUMENTS → (SESSION_EXPIRED ⇄ AUTH_REQUIRED)* → DOCUMENTS_LOCAL → PROCESSING_DOCUMENTS → EXTRACTING_REQUIREMENTS → UPLOADING → REPORTING → COMPLETE`, with `FAILED_RETRYABLE`/`FAILED_MANUAL` reachable from most states. Full transition table lives in `src/state/jobStateMachine.ts` once implemented (Plan 1).

**Auth session** (nested under job): `NOT_STARTED → AUTH_PENDING → AUTHENTICATED → SESSION_EXPIRED | TAB_LOST`. Both failure states fold into job-level `AUTH_REQUIRED` — cause is never distinguished.

**Search** (one per configured search, 7 total): `PENDING → RUNNING → PAGINATING(page_n) → COMPLETE | INTERRUPTED`.

**Tender classification:** four independent gate rows `G1/G2/G3/G4`, each `{PASS|REJECT|UNCERTAIN|NOT_RUN}` with `reason_code`, evidence, classifier version. Final classification (`KEEP|REJECT|UNCERTAIN`) is always **recomputed** from the four gate rows via the precedence rule `REJECT > UNCERTAIN > KEEP`, never stored as an independently settable field.

**Document** (per tender, per type: NIT/WORK_ITEMS_ZIP/BOQ/SUPPORTING): `PENDING → AWAITING_FILE → DOWNLOADED → VERIFIED_LOCAL → PROCESSING → PROCESSED → UPLOADING → UPLOADED → VERIFIED_CLOUD`.

Every transition at every layer is written in the same SQLite transaction as an append-only `state_transitions` audit row (`entity_type`, `entity_id`, `from_state`, `to_state`, `reason`, `occurred_at`). Resume logic is always "find the first row not yet in a terminal state for its phase" — never a re-derived summary.

## Browser strategy (retaining the exact authenticated tab)

1. Launch the user's real Chrome with a dedicated profile dir + CDP port.
2. Attach via `connectOverCDP`; open exactly one `Page` for TN Tenders and record its CDP `targetId` on the job's auth-session row. No `context.newPage()` for TN Tenders traffic, ever, after that.
3. Auth is confirmed only when all three DOM indicators are present in that page: `Welcome : <email>`, `Logout`, `Bid Management`.
4. Loss detection: `page.on('close')`, CDP `Target.targetDestroyed` for that specific `targetId`, and navigation to a URL/body matching the `page=CommonErrorPage` session-expired pattern. Any of these → job state `AUTH_REQUIRED`/`SESSION_EXPIRED`, checkpoint immediately, no reconstruction attempts.
5. No artificial keep-alive in V1; rely on sequential acquisition speed until a POC proves idle-timeout is a real problem.

**Detector precedence (added 2026-09-17, Plan 2 final review):** `isAuthenticatedDashboard()` and `isSessionExpiredPage()` (both in `src/browser/`, Plan 2) can both return `true` on the same page — a session-expiry notice can render inside authenticated chrome that still shows `Welcome :`/`Logout`/`Bid Management` in the header. **`isSessionExpiredPage()` must be checked first** in Plan 3's polling loop; expiry wins whenever both match. Do not leave this to call-order convention — check it explicitly.

**`AuthSessionRepository.setCdpTargetId()` has no set-once guard or clear method yet (deferred from Plan 2 to Plan 3).** Nothing calls it yet, so a design decision (should re-pointing an existing session's `cdp_target_id` be allowed, or should it throw? does `TAB_LOST` need to null it out?) was deliberately deferred until Plan 3's controller is the real caller and the actual usage pattern is known, rather than guessing now. Design this when Plan 3 writes the code that calls it.

**Plan 3 launch hygiene:** spawn Chrome via `child_process.spawn(path, args)` with **no `shell: true`** — `buildChromeLaunchArgs()` (Plan 2) interpolates a user-derived `userDataDir` into `--user-data-dir=...`, harmless as a plain argv element but an injection vector under a shell. The Chrome profile directory holds live TN Tenders session cookies and DSC state: keep it under the user's own `%APPDATA%` with default ACLs (a `getChromeProfileDir()` alongside `src/config/paths.ts`'s existing `getDatabasePath()` is the natural place), and never log or upload its contents.

## Download correlation strategy

Acquisition is strictly sequential (never more than one `AWAITING_FILE` document at a time). Before a download-triggering click: write a `download_expectations` row. Register `page.on('download', ...)` on the retained page *before* the click. On the event, call `download.saveAs()` to a TenderAssist-chosen destination path keyed by `tender_id`/`document_type` — never let the OS assign `(1)`, `(2)` suffixes, and never identify a document by filename alone.

## Known limitation: logger redaction on long reference cycles (2026-09-17)

`src/observability/logger.ts`'s `redactValue()` recursion checks `depth > MAX_REDACTION_DEPTH` (5) before it checks the cycle guard (`seen.has(value)`). A reference cycle of 5+ distinct objects (e.g. `a.n=b; b.n=c; c.n=d; d.n=e; e.n=a`) hits the depth cutoff before the cycle guard ever triggers, so the still-circular raw object is returned and `JSON.stringify()` in `write()` throws. Verified: cycles up to 4 nodes redact and serialize correctly (the cycle guard fires first); a 6-node cycle reproduces the crash. Fix (deferred, not yet applied — trivial and low-risk when it's needed): reorder the two checks so the cycle guard runs before the depth cutoff, or track depth and cycle detection as one combined check.

**Still live after Plan 2 (confirmed 2026-09-17, Plan 2 final review):** Plan 2 added no logging calls at all, so this stayed latent through it. **Plan 3 is the one that will trip it** — it logs CDP targets and session objects, which are deeply nested and can be self-referential (a Playwright `Page`/`Browser` handle, or a raw CDP event payload, commonly back-references its own parent). Fix this in Plan 3's first task that adds real object logging, before that task's own review, not after.

## Transaction composition (decision, 2026-09-17)

`withTransaction` (in `src/persistence/db.ts`) is **not re-entrant** — nesting two calls throws `cannot start a transaction within a transaction` (it fails safe: the outer transaction cleanly rolls back, the connection is never left mid-transaction). `JobStateMachine.transition()` always opens its own transaction internally. Decision, to avoid speculative savepoint-support machinery before it's actually needed: **callers must never wrap a call to `JobStateMachine.transition()` — or any repository method that itself calls `withTransaction` — inside another `withTransaction` block.** If Plan 2's acquisition loop needs "write document rows and transition the job atomically" in one unit, it must either (a) perform the document writes first, then call `transition()` as a separate, immediately-following step (acceptable per the document-level checkpointing model — a document write and a job transition are different granularity anyway), or (b) if true atomicity across both is later proven necessary, make `withTransaction` savepoint-aware (`SAVEPOINT`/`RELEASE`/`ROLLBACK TO` when `db` reports it's already mid-transaction) as a dedicated, tested change — not bolted on ad hoc.

## Model boundary

Deterministic (code): G1 freshness, G2 product-category match, pagination/dedup, download correlation, file verification, PDF text-layer detection, BOQ parsing, all state machine transitions.
Semantic (`SemanticModelProvider`, schema-validated, retried once on invalid output then marked `UNCERTAIN`/`MODEL_OUTPUT_INVALID` — never silently defaults to PASS/KEEP): G3 primary-deliverable, G4 maintenance/build-scope, PQ/eligibility requirement extraction.

## Unknowns requiring POC validation (do not invent behavior for these)

1. Whether DSC signing actually requires the real installed Chrome vs. working over CDP-attached automation.
2. Whether TN Tenders has automation/CDP detection that behaves differently from human-driven navigation.
3. Machine/browser crash recovery mid-acquisition.
4. CAPTCHA behavior on reauthentication.
5. Whether continuous legitimate navigation prevents the observed 20-minute idle timeout.
6. Any session-lifetime cap beyond idle timeout.

## Phase plan (Zone A POC only)

0. Foundation: scaffolding + SQLite persistence + Job state machine — **this plan (Plan 1)**.
1. Browser controller + auth detection POC (Plan 2, depends on Plan 1).
2. Session-expired detection + reauth + resume.
3. Configured searches (7) with pagination + persistence.
4. G1/G2 deterministic gates.
5. `SemanticModelProvider` + G3/G4, with the `EB_704783` regression fixture.
6. Shortlist → sequential acquisition → download correlation.
7. Click reliability abstraction with fresh-screenshot coordinate fallback.
8. Full multi-tender POC run per the test matrix, including induced session expiration and app restart.

Each phase gets its own plan under `docs/superpowers/plans/`, written once the prior phase is implemented — no speculative abstractions ahead of need.
