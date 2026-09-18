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

## Decision: BrowserController has no close()/disconnect() (2026-09-17, Plan 3, resolved in Plan 3's final review)

`BrowserController` (`src/browser/browserController.ts`) has no method to cleanly detach the CDP connection or signal shutdown — deliberately: its only real caller (`src/scripts/manualAuthVerification.ts`) is a short-lived script, and a future plan hosting a long-lived orchestrator (e.g. inside Electron's main process) should design a `close()` against its own real lifecycle requirements (disconnect-only vs. also kill Chrome? survive app restarts?) rather than this plan guessing now. **Correction to the original rationale:** the original note claimed OS process exit reclaims everything because Chrome is spawned `detached`. That's true of the Chrome *process* but is not why `manualAuthVerification.ts` hangs after printing its result — verified directly: a Node process holding a live `connectOverCDP` WebSocket stays alive indefinitely on its own, independent of Chrome's detached-ness. The script's hang (fixed in Plan 3's final review with an explicit `process.exit()`) is caused by the open CDP connection pinning the event loop, which is exactly why a future `close()`/`disconnect()` on `BrowserController` would be the *principled* fix — `process.exit()` in the script is a deliberate stopgap, not a mystery workaround.

## Decision: `AuthSessionRepository.setCdpTargetId()` set-once guard (2026-09-17, resolved in Plan 3's final review)

Closing the open item from Plan 2's spec note: no guard was added. `AuthFlow.start()` (Plan 3) is the sole caller in the codebase, and it calls `setCdpTargetId()` exactly once per auth session, immediately after `attach()` — a lost session gets a brand-new `AuthSessionRepository.create()` row on retry (per Plan 2's append-only design), never a re-point of an existing row's `cdp_target_id`. The invariant holds by construction; a hard guard would be defensive code with no caller that could ever trigger it.

## Resolved: job state reacts to auth-session loss (2026-09-17, Plan 4)

Closes the gap flagged after Plan 3's final review: `AuthFlow` transitioned only the `auth_sessions` row on `TAB_LOST`/`SESSION_EXPIRED`, leaving the parent **job** row stranded in `AUTH_PENDING` indefinitely. Mechanism (deliberately keeping `AuthFlow` itself free of any job-domain import, per the original gap note's design intent): `AuthFlowDeps` gained an optional `onAuthSessionLost?: (reason, terminalState) => void` slot, invoked by `AuthFlow` after a terminal auth-session transition commits. `src/browser/authJobCoordinator.ts`'s `reactToAuthSessionLoss(jobMachine, jobId)` builds the actual job-reacting callback — a structural guard (catches `IllegalJobTransitionError`, not a hardcoded state list) that transitions the job to `AUTH_REQUIRED` whenever that's a legal transition from the job's current state, and silently no-ops otherwise. Verified correct against all 17 job states in `VALID_TRANSITIONS`, not just the ones exercised by unit tests, and end-to-end via a real dry run confirming the job row (not just the auth session) reached `AUTH_REQUIRED` in the actual database.

**Deliberate divergence from the Browser strategy step 4 wording below** ("job state `AUTH_REQUIRED`/`SESSION_EXPIRED`"): the auth-loss reaction always targets `AUTH_REQUIRED`, never job-level `SESSION_EXPIRED` — from `AUTH_PENDING` (where auth loss is detected today) the job table has no `SESSION_EXPIRED` edge at all, so a terminal-state-driven target would be unreachable half the time. Job-level `SESSION_EXPIRED` is reserved for losses detected by the search/acquisition stages once they exist (`AUTHENTICATED`/`SEARCHING`/`ACQUIRING_DOCUMENTS` do have that edge) — the auth-loss path normalizes to `AUTH_REQUIRED` and carries the specific cause (`TAB_LOST` vs `SESSION_EXPIRED`, plus the browser-level reason) in the `state_transitions` audit row's free-text reason instead.

**Known side effect for a future retry-scheduler plan:** `FAILED_RETRYABLE → AUTH_REQUIRED` is a legal, real transition in `VALID_TRANSITIONS`. If a job is `FAILED_RETRYABLE` and the browser tab happens to close, this callback silently moves it back onto the auth path — a browser event doing the job of a retry policy, with no retry counter or backoff. Harmless today (nothing produces `FAILED_RETRYABLE` yet), but whichever plan introduces the retry scheduler should treat this as a known interaction to design around, not a mystery to debug.

## Resolved: logger redaction false-positive on identifier fields (2026-09-17, Plan 3, corrected during final review)

Plan 2's final review widened `SECRET_KEY_FRAGMENTS` to include `'session'`; Plan 3's manual verification script logs `authSessionId`, which redacted to `[REDACTED]` because the substring `"session"` appears in the field name. **The originally recommended fix (removing the bare `'session'` fragment) was checked during Plan 3's final review and found to be ineffective** — `authSessionId` also matches the pre-existing `'auth'` fragment, so removing `'session'` alone would not have stopped the redaction, while also weakening real `session`-keyed secret detection for no benefit (and breaking an existing test asserting a literal `session` key redacts). The actual fix applied: an identifier-key exemption in `src/observability/logger.ts` — a key matching `/(^|[a-z0-9])_?ids?$/i` (e.g. `authSessionId`, `jobId`, `apiKeyId`) is never treated as secret, checked before the fragment-substring scan, leaving `SECRET_KEY_FRAGMENTS` itself untouched. This also fixes the same class of false positive for any future `...Id` field, not just this one.

## Resolved: logger cycle-guard depth-ordering bug did not trigger in Plan 3 (2026-09-17)

The "Known limitation: logger redaction on long reference cycles" section (below) predicted Plan 3 would log "CDP targets and session objects, which are deeply nested and can be self-referential," and instructed the ordering bug be fixed before that logging landed. In practice, Plan 3's only log calls (`manualAuthVerification.ts`) pass flat `{ jobId, authSessionId }` — two strings, no nested/circular objects. The deferral correctly did not trigger and remains open for whichever future plan is first to log a real object (a Playwright handle, a raw CDP event payload, etc.).

## Resolved: Chrome-profile temp-dir cleanup retry budget widened for full-suite contention (2026-09-17, Plan 3 fix-wave)

`tests/support/removeDirWithRetry.ts` (added to fix the fix-wave's IMPORTANT #3, measured 372 leaked temp dirs at HEAD) was verified against an isolated single-file probe with a 10-attempt/200ms (~2s) budget and passed 6/6. Re-measured here against a full `npm test` run (all three real-Chrome test files' spawn/kill cycles happening concurrently across Vitest's parallel workers, not one file at a time): roughly half the profile dirs (29 of 55 created across 5 runs) still weren't released within the 2s budget. Widened to 30 attempts/200ms (~6s) and re-verified: 0 new leaked dirs across 5 subsequent full-suite runs. Still gives up quietly past the budget rather than ever failing a passing test — this only changes how long it's willing to wait first.

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

## Known gap: `tenders.product_category` ambiguity and missing search↔tender linkage (2026-09-17, Plan 5, flagged in final review — open for Plan 6)

`004_tenders.sql` (Plan 5) gives each `tenders` row exactly one `product_category` column and dedups on `(job_id, tender_ref)` with no reference to which of the 7 configured searches actually surfaced it. Per the "Verified against the real portal" section of `docs/superpowers/plans/2026-09-17-poc-plan5-search-foundation.md`, Gate 2's authoritative field is the tender's own **detail-page** Product Category (found inside each Work Item's details section), which is a separate read from the configured search's own `product_category` that found the row in the first place — and the two can legitimately differ when a tender surfaces via more than one of the 7 searches. Today, `TenderRepository.upsert()` is idempotent on `(job_id, tender_ref)`: the first search to find a tender wins, and every later search that also finds it is silently dropped, along with whatever `product_category` it carried. If the surviving row's `product_category` is the *matched search's* category rather than the *detail page's*, Gate 2 could incorrectly reject a tender that legitimately matched one of its searches, because only one candidate category survived dedup. Nothing in Plan 5 decides whether `tenders.product_category` should hold the matched search's category or the detail page's category, or how to preserve the discarded match(es). This is deliberately left open rather than decided here — options include a `search_id` foreign key on `tenders`, a separate `search_tenders` link table (one row per (search, tender) match, preserving every match), or splitting the single column into `matched_search_category` and `detail_page_product_category`. Plan 6 must resolve this before it writes its first real row from a live search.

## Known gap: `searches` has no state machine and writes no audit row (2026-09-17, Plan 5, deliberate deferral — matches Plan 3's `BrowserController` precedent)

The State model section above states as a universal invariant that "every transition at every layer is written in the same SQLite transaction as an append-only `state_transitions` audit row." `SearchRepository.updateState()` (Plan 5, Task 1) does not validate that a transition is legal and writes no `state_transitions` audit row — it is marked `@internal` in `src/persistence/repositories/searchRepository.ts`, pending a future orchestrator. This is a deliberate deferral, not an oversight: nothing in the codebase calls `updateState()` yet (Plan 5 builds no search-execution loop), so there is no real caller yet whose actual transition pattern a `SearchStateMachine` could be designed against — the same reasoning Plan 3 applied to deferring `BrowserController.close()`/`disconnect()` (see the decision above) rather than build one now against a guessed usage pattern. Whichever plan first drives real search execution (Plan 6, per the "Next Plan" section of the Plan 5 doc) owns building `SearchStateMachine` and wiring `updateState()` through it with a real audit row, the same way `AuthFlow`/`JobStateMachine` already do. No `SearchStateMachine` should be built ahead of that need.

## Pointer: real verified-portal findings live in the Plan 5 doc (2026-09-17)

The 99-value Product Category dropdown, the CAPTCHA-on-every-search finding, the exact search-results table column order, and the detail-page field labels (Tender Category, Product Category, Published Date, Tenders Documents) are all recorded with real captured examples in `docs/superpowers/plans/2026-09-17-poc-plan5-search-foundation.md`'s "Verified against the real portal" section — consult that section rather than assuming these are undocumented.
