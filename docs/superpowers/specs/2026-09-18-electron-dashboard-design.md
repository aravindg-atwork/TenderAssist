# TenderAssist Electron Dashboard — Design (Auth-Flow Milestone)

**Status:** Approved design, pending implementation plan.

**Context:** Plans 1-5 built TenderAssist's backend entirely — persistence, browser automation, state machines, search config, parsers, classification gates — with zero UI. The only end-to-end runnable flow today is auth (`src/scripts/manualAuthVerification.ts`): create a job, launch a real Chrome window via CDP, let a human log in, poll until authenticated or terminal. Everything past auth (live search execution, document acquisition, classification persistence) is Plan 6+ and does not exist yet.

This spec covers the **first UI milestone only**: an Electron desktop app that makes the existing auth flow visible and clickable, with nothing stubbed or faked for screens that have no backend yet.

## Goals

- Give the user a real window to look at instead of a bare Chrome tab + terminal output.
- Cover exactly the auth flow that already works end-to-end today. No placeholder screens for search/classification/documents.
- Reuse the existing backend modules directly — no new server, no HTTP API, no duplicated orchestration logic.

## Non-goals (explicitly out of scope for this milestone)

- Search execution, tender review/approval, document viewing screens (no backend exists for these yet).
- Packaging/installer (electron-builder/forge config) — dev-mode `electron .` is sufficient for now.
- Automated UI/renderer tests — no headless-Electron test runner is set up in this pass; verification is manual.
- Multi-user, remote access, or any network-facing surface — this stays a single-machine local app, consistent with every prior plan's assumptions.

## Architecture

```
Electron app
├── main process (Node.js host)
│   ├── imports existing backend modules directly:
│   │   JobRepository, AuthSessionRepository, StateTransitionRepository,
│   │   JobStateMachine, AuthStateMachine, AuthFlow, chromeLauncher,
│   │   reactToAuthSessionLoss
│   ├── src/orchestration/authJobRunner.ts (NEW — extracted from
│   │   manualAuthVerification.ts's main() body)
│   └── IPC handlers (contextBridge-exposed, see IPC contract below)
└── renderer (React + TypeScript, Vite-bundled)
    ├── Job list screen
    └── Job detail screen
```

No server, no HTTP layer. The main process is just another caller of the same code Plans 1-4 already built and tested — exactly like `manualAuthVerification.ts` is today, except it drives a UI instead of `console.log`.

### `src/orchestration/authJobRunner.ts` (new, shared)

Extracts the sequence currently inlined in `manualAuthVerification.ts`'s `main()`: create job → transition `AUTH_REQUIRED` → launch Chrome → construct `AuthFlow` (wired to `reactToAuthSessionLoss`) → `flow.start()` → transition `AUTH_PENDING` → navigate to the portal URL → poll `checkAuthenticated()` until `SUCCESS` / `TIMEOUT` / `ABORTED`.

Signature: `runAuthJob(portalUrl: string, onUpdate: (update: AuthJobUpdate) => void): Promise<AuthJobUpdate>`, where `AuthJobUpdate` carries `{ jobId, authSessionId, jobState, authState, outcome? }`. `onUpdate` is called every time the polling loop observes a state change (not on every poll tick) — this is the seam both callers plug into:

- `manualAuthVerification.ts` becomes a thin wrapper: calls `runAuthJob(portalUrl, (u) => console.log(...))`, keeping its existing CLI behavior (including exit codes) unchanged for anyone still using it standalone.
- The Electron main process calls it too, with `onUpdate` forwarding to `webContents.send('job-updated', update)` instead of `console.log`.

The portal URL is hardcoded to `https://tntenders.gov.in/nicgep/app` (the real, verified portal base URL — see Plan 5's "Verified against the real portal" notes) inside the Electron caller; the CLI script keeps taking it as an argument (existing behavior, unchanged) for whoever needs to point it elsewhere during testing.

### Renderer: screens

**Job list (home screen):** a table from a new `JobRepository.listAll(): JobRow[]` method (ordered `created_at DESC`) joined in the IPC handler with each job's latest auth session state via the existing `AuthSessionRepository.getLatestForJob(jobId)`. Columns: job id (short/truncated), job state badge, latest auth state, created/updated timestamps. A **"Start new job"** button above the table. Clicking a row navigates to that job's detail screen.

Only one job can be actively running through the UI at a time in this milestone, matching the CLI script's own one-process-one-job model (and avoiding the ambiguity of multiple simultaneous real Chrome windows/CDP ports). The main process tracks whether `runAuthJob` is currently in flight and the IPC handler rejects a second `startJob()` call while one is active; the renderer disables the "Start new job" button whenever `listJobs()`/`onJobUpdate` indicates a job is in a non-terminal state that this session started. A job that's simply sitting in history in a non-terminal state from a *previous* app run (e.g. the app was closed mid-poll) does not block a new `startJob()` call — only a job actively being polled in the current process does.

**Job detail screen:** job state badge, auth session state badge, and an audit timeline built from the existing `StateTransitionRepository.listFor('job', jobId)` and `listFor('auth_session', authSessionId)` (already exists, ordered `occurred_at ASC` — exactly what a timeline needs, no new repository code required here). While a job is actively running (started from this session, Chrome open, `authJobRunner` polling), the screen subscribes to `job-updated` IPC events for that `jobId` and re-renders live; for a past/inactive job it's a static read of history on screen load.

## IPC contract

Exposed via `contextBridge` as `window.tenderAssist`:

- `listJobs(): Promise<JobListItem[]>` — `JobRow` + latest auth state, for the home screen.
- `startJob(): Promise<{ jobId: string }>` — kicks off `runAuthJob()` in the main process (fire-and-forget from the renderer's perspective; does not await completion), returns immediately once the job row + Chrome launch have started.
- `getJobDetail(jobId: string): Promise<JobDetail>` — job row, latest auth session row, both transition histories.
- `onJobUpdate(callback: (update: AuthJobUpdate) => void): () => void` — subscribes to `job-updated` events; returns an unsubscribe function.

## Error handling

`runAuthJob`'s three existing terminal outcomes (`SUCCESS`, `TIMEOUT`, `ABORTED`) flow through `AuthJobUpdate.outcome` and render as a status banner on the job detail screen (green/gray/red) — this is a presentation of behavior `manualAuthVerification.ts` already has today, not new error semantics. A Chrome-launch failure (`resolveChromePath()` throwing because Chrome isn't installed, or `waitForCdpReady()` timing out) is caught in the IPC handler for `startJob()` and surfaced as an immediate error toast in the renderer, before any job row's failure state needs to be inferred from the UI.

## Testing

- `src/orchestration/authJobRunner.ts` gets unit tests following the exact pattern already established for `AuthFlow`/`authJobCoordinator`: real in-memory SQLite via `runMigrations`, `describe.skipIf(!CHROME_PATH)` guarding the parts that need a real Chrome install, asserting on the sequence of `onUpdate` calls rather than console output.
- `manualAuthVerification.ts`'s own existing behavior (CLI exit codes, printed messages) gets a regression check that it still behaves identically after being rewired onto `runAuthJob` — no behavior change intended, so no new test scenarios needed beyond confirming the existing dry-run procedure (Plan 3 Task 4's technique) still produces the same outcomes.
- The React renderer and Electron shell get **no automated test suite** in this milestone — no headless-Electron runner exists in this environment, and this environment cannot drive a real Electron GUI window. Verification is manual: build it, launch it (`npm run electron` or equivalent dev script, to be defined in the implementation plan), click "Start new job", and confirm the window updates live through the same states the CLI script already proves work.

## Open questions carried to the implementation plan (not blocking this design)

- Exact Electron/Vite/React dependency versions and project scaffolding layout (e.g. `electron/` vs `src/main`/`src/renderer` split) — an implementation-plan-level decision, not a design one.
- Whether `npm run electron` needs a `concurrently`-style dev script (Vite dev server + Electron) or a simpler build-then-launch flow for this early stage — left to the plan.
