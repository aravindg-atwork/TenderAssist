# Tender-centric data model and Inbox — design

Date: 2026-09-24
Status: Decisions recorded 2026-09-24. Slice 1 delivered (migration 010, `OpportunityRepository`, `src/state/opportunityLifecycle.ts`, backfill). Slice 2 next.
Backlog: Recommended delivery order step 2

## Goal

Make a tender a durable record that outlives the job that found it, and build the Inbox → Approve workflow on that record. The operator should work in tenders; jobs become run history.

## Non-goals

- GeM adapter, OCR, eligibility review, company profile, calendar (later steps).
- Accounts, roles, assignments, shared comments, cloud database, live sync, team dashboards.
- Changing how search, classification gates, or document download work inside a run.

## Product constraints (decided 2026-09-24)

**Today:** a single-operator, local-first desktop tool. Local SQLite and folders, Drive mirroring, backup/export, personal reminders, full audit trail.

**Later:** a cloud product sold to other tender bidders. Today's workflow must not carry team architecture, but everything new must be cheap to lift into a multi-tenant service:

| Rule | Why |
|---|---|
| Stable UUID primary keys, no rowid or path-based identity | Rows can move between databases |
| `workspace_id` on every new domain table (default `'local'`) | Becomes the tenant key; no schema rewrite later |
| Events record `actor` (`automation` / `operator`) plus nullable `actor_id` | Becomes the user ID once accounts exist |
| UTC ISO-8601 timestamps; format only in the UI | Server and clients in different time zones |
| Append-only event logs; current state is a cache of the log | Syncable, auditable, conflict-friendly |
| New file paths stored relative to the output root | Storage can move to object storage |
| Domain logic in plain TypeScript services under `src/`, not in `electron/main.ts` | A server can reuse it unchanged |

Portal login stays human-only (CAPTCHA, OTP, and the DSC USB token), so a cloud version will still need a local companion for authentication. This design does not decide that architecture.

## Current state

- `tenders` rows are per job: `UNIQUE (job_id, tender_ref)`. The same tender found by two runs is two unrelated rows.
- Reviews (`tender_reviews`), documents (`tender_documents`), requirements (`tender_requirements`), classification gates, and output serials all key off that per-job row.
- Deleting a job deletes its tenders and every decision about them.
- There is no Defer, no decision history (a review is overwritten in place), and no lifecycle beyond job state.

## Design

### 1. Two layers: opportunities and sightings

Keep `tenders` as it is, reinterpreted as a **sighting**: "job X saw this tender on this page with these values". Add an **opportunity**: the tender itself, one row per real-world tender.

```sql
CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'local',
  portal_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,          -- see Identity below
  tender_portal_id TEXT,
  tender_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  organisation_chain TEXT,
  department TEXT,
  state_name TEXT,
  published_date TEXT,
  closing_date TEXT,                   -- portal text, as shown
  closing_at TEXT,                     -- UTC ISO, parsed from closing_date; drives expiry
  value_in_rupees TEXT,
  lifecycle TEXT NOT NULL,             -- see Lifecycle below
  recommendation TEXT,                 -- latest automatic KEEP / REJECT / UNCERTAIN
  changed_since_decision INTEGER NOT NULL DEFAULT 0,  -- set by CHANGED/CORRIGENDUM after a decision
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  latest_sighting_id TEXT,             -- tenders.id with the freshest values
  UNIQUE (workspace_id, portal_id, identity_key)
);
ALTER TABLE tenders ADD COLUMN opportunity_id TEXT REFERENCES opportunities (id);
```

Opportunity columns are a denormalised copy of the latest sighting, so the Inbox is one table scan. Sightings stay immutable history.

Why not merge into `tenders`: every run-level repository, the classification gates, and the output plans already key on `tenders.id`. Adding a parent keeps them working unchanged and makes the migration additive.

### 2. Identity

`identity_key` = normalised `tender_portal_id` (GePNIC "Tender ID", e.g. `2026_TNPWD_123456_1`) when present, otherwise normalised `tender_ref`. Normalisation: trim, collapse whitespace, upper-case.

- Scope is per portal. The same ID on two portals is two opportunities; cross-portal similarity is a later "related opportunities" link, not identity.
- When a new sighting's identity matches, attach it and update `last_seen_at`, `latest_sighting_id`, and the copied columns.
- If closing date, value, or title differ from the previous sighting, record a `CHANGED` event with the before and after values.

**Corrigenda (confirmed from TN Tenders):** corrigenda keep the same Tender ID. `2026_ELCO_674849_1` carries Corrigendum 1–10 on one record, and the trailing `_1` never changes, so it is not a corrigendum number.

- Same Tender ID → same opportunity. Each corrigendum is stored as a dated `CORRIGENDUM` event (`data_json`: portal-listed number, date, and what changed: deadline, BOQ, fee, technical document, cancellation). It never creates a new Inbox item. It sets a "changed since you decided" flag on the opportunity.
- Corrigendum numbers come only from the portal's own corrigendum listing, never from `_1`, titles, or file names.
- A new Tender ID with a similar reference or title is linked as `POSSIBLE_RETENDER` in `opportunity_links` and shown as "Possible retender / related tender". It is never merged automatically.
- Parsing the portal's corrigendum listing needs a captured detail-page fixture and is its own slice (slice 2b). Slice 1 provides the event kind and the storage.

```sql
CREATE TABLE opportunity_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'local',
  from_opportunity_id TEXT NOT NULL REFERENCES opportunities (id),
  to_opportunity_id TEXT NOT NULL REFERENCES opportunities (id),
  kind TEXT NOT NULL,              -- POSSIBLE_RETENDER (more kinds later)
  confirmed_by_operator INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (from_opportunity_id, to_opportunity_id, kind)
);
```

### 3. Lifecycle

Tender state, separate from job state and portal/auth state:

```
NEW ─► SCREENED ─► APPROVED ─► DOCUMENTS_COLLECTED ─► (later steps: ELIGIBILITY_REVIEWED ─► PREPARING ─► SUBMITTED / NOT_SUBMITTED ─► WON / LOST)
            │
            ├─► REJECTED
            └─► DEFERRED ─► (back to SCREENED on review)
Any open state ─► EXPIRED (closing date passed) / CANCELLED (portal withdrew it)
```

- `NEW`: seen but not yet through gates (a run was interrupted).
- `SCREENED`: gates ran; automatic KEEP / REJECT / UNCERTAIN recorded. Automatic REJECT does **not** move a tender to REJECTED. It stays SCREENED with a reject recommendation, and the Inbox hides it by default.
- Only a human moves a tender to APPROVED, REJECTED, or DEFERRED.
- This step implements the states up to DOCUMENTS_COLLECTED plus EXPIRED. The later states exist in the enum but have no UI yet.

### 4. Decisions as an append-only event log

```sql
CREATE TABLE opportunity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'local',
  opportunity_id TEXT NOT NULL REFERENCES opportunities (id),
  kind TEXT NOT NULL,        -- SEEN, SCREENED, CHANGED, CORRIGENDUM, APPROVED, REJECTED, DEFERRED,
                             -- REOPENED, DOCUMENTS_COLLECTED, EXPIRED, NOTE
  actor TEXT NOT NULL,       -- 'automation' | 'operator'
  actor_id TEXT,             -- null until accounts exist
  job_id TEXT,               -- run that caused it, if any
  note TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_opportunity_events_opp ON opportunity_events (opportunity_id, created_at);
```

`opportunities.lifecycle` is the cached result of the log. Every lifecycle change writes the event and updates the cache in one transaction, following the pattern `JobStateMachine` already uses. This log is the base for the backlog's exportable audit history.

`tender_reviews` stays for backward compatibility. It is written alongside APPROVED/REJECTED events until the old review panel is removed, and then it can be dropped.

### 5. Explanations

Each Inbox row shows one plain sentence built from the existing gate rows (`tender_classification_gates.reason_code` + `evidence_json`), for example: "Kept — category Information Technology, matched 'web portal development'" or "Uncertain — detail page did not load (G2)". This needs a `reason_code → sentence` table in the renderer; no schema change.

### 6. Job deletion

Deleting a job deletes its run history (sightings, gates, searches, transitions) only when no opportunity depends on a sighting for a human decision or downloaded documents. Otherwise the sightings stay and are marked orphaned (`job_id` kept, job row gone). Decisions must never disappear because a run was cleaned up. The UI copy changes from "Delete job" to "Remove from run history".

### 7. Migration (010)

1. Create `opportunities`, `opportunity_events`, and `opportunity_links`; add `tenders.opportunity_id` and `jobs.reviewed_at`. Mark existing jobs reviewed so that old auto-rejects do not flood the new Inbox.
2. For every existing `tenders` row, in `created_at` order: compute `(portal_id from job_run_configs, identity_key)`, then find or create the opportunity and set `opportunity_id`.
3. Lifecycle from the existing data: manual KEEP with downloaded documents → DOCUMENTS_COLLECTED; manual KEEP → APPROVED; manual REJECT → REJECTED; gates present → SCREENED; otherwise NEW. Closing date in the past on an open state → EXPIRED.
4. Write one synthetic event per backfilled decision (`actor` from the source, `note` = old review reason).

Implemented as SQL + a TypeScript backfill step run once after the SQL migration. `runMigrations` only runs `.sql` files today, so this adds a small post-migration hook. It is covered by a test that seeds pre-010 rows and asserts the result.

### 8. IPC surface

| Channel | Purpose |
|---|---|
| `list-opportunities(filter)` | Inbox and Tenders views. Filter: lifecycle set, portal, recommendation, text search, sort |
| `get-opportunity(id)` | Detail: latest values, sightings, events, gates, documents |
| `decide-opportunities(ids[], decision, note?)` | Approve / Reject / Defer / Reopen, one or many, single transaction |
| `inbox-counts()` | Badge counts for navigation |

Document download after approval keeps the current `waitForDocumentSelection` path in this step. The selection is prefilled from APPROVED opportunities seen in the run. Downloading approved tenders outside a run is a follow-up because it needs an authenticated session.

### 9. UI

Navigation: **Inbox · Tenders · Runs · Settings** (Calendar arrives with step 5). The current job list becomes **Runs**, unchanged apart from its label.

**Inbox** (default view when it has items):

- Main section: tenders needing attention, grouped *Uncertain*, then *Recommended*, then *Changed since decision* (corrigenda on tenders already decided).
- Bottom section: **Automatically rejected (N)**, collapsed by default. When expanded, each row shows title, rejection reason, and the matched exclusion, with a **Move to review** action (a `REOPENED` operator event).
- The auto-rejected group covers only runs not yet acknowledged. **Done with this run** (or closing the run) sets `jobs.reviewed_at`, and those rejects leave the Inbox. They always remain under Tenders → Rejected.
- Row: full title (wraps, no truncation), department, closing date shown as relative time with the absolute date in a tooltip, value, explanation sentence, and a CHANGED badge when a newer sighting changed dates or value.
- Actions per row: Approve, Reject, Defer, with an optional note. Keyboard: `J`/`K` move, `A` approve, `R` reject, `D` defer, `N` note.
- Bulk: select within *Recommended* → "Approve N tenders" with a confirmation listing the titles.
- Empty state: "Nothing to review. Start a discovery run for today" with the Start button.

**Tenders**: every non-Inbox opportunity grouped by lifecycle, with a per-tender timeline built from events.

Human-readable timestamps across all three views, with a single shared formatter.

## Testing

- Repository: identity normalisation, attaching repeat sightings, CHANGED events on value/date change, lifecycle transitions (legal and illegal), bulk decide atomicity.
- Migration: seeded pre-010 database → expected opportunities, lifecycle, events; idempotent re-run.
- Runner: a second run on another date that sees an approved tender does not return it to the Inbox, and does record a sighting.
- Job deletion: a job with a human-approved tender keeps the opportunity and its events.
- Renderer: explanation sentences for every gate reason code; keyboard review flow.

## Delivery slices

1. Schema, migration, backfill, and the repository with tests. No UI change.
2. Runner writes sightings → opportunities and events; job deletion rules.
3. Inbox view with single decisions and explanations; navigation rename.
4. Bulk decisions, keyboard review, Tenders view with timeline.

Each slice is shippable and keeps today's review panel working until slice 3 replaces it.

## Resolved questions

1. Corrigenda keep the same Tender ID (see Identity).
2. Automatic rejects stay visible as a collapsed Inbox group until the run is acknowledged.
3. Single operator and local-first now; cloud-ready constraints above.
4. EXPIRED is applied by a sweep at app start, which writes events. This is the working choice and can be revisited.
