# Tender-centric data model and Inbox — design

Date: 2026-09-24
Status: Draft for review
Backlog: Recommended delivery order step 2

## Goal

Make a tender a durable record that outlives the job that found it, and build the Inbox → Approve workflow on that record. The operator should work in tenders; jobs become run history.

## Non-goals

- GeM adapter, OCR, eligibility review, company profile, calendar (later steps).
- Team features (single-operator decision in the backlog).
- Changing how search, classification gates, or document download work inside a run.

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
  portal_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,          -- see Identity below
  tender_portal_id TEXT,
  tender_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  organisation_chain TEXT,
  department TEXT,
  state_name TEXT,
  published_date TEXT,
  closing_date TEXT,
  value_in_rupees TEXT,
  lifecycle TEXT NOT NULL,             -- see Lifecycle below
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  latest_sighting_id TEXT,             -- tenders.id with the freshest values
  UNIQUE (portal_id, identity_key)
);
ALTER TABLE tenders ADD COLUMN opportunity_id TEXT REFERENCES opportunities (id);
```

Opportunity columns are a denormalised copy of the latest sighting, so the Inbox is one table scan. Sightings stay immutable history.

Why not merge into `tenders`: every run-level repository, the classification gates, and the output plans already key on `tenders.id`. Adding a parent keeps them working unchanged and makes the migration additive.

### 2. Identity

`identity_key` = normalised `tender_portal_id` (GePNIC "Tender ID", e.g. `2026_TNPWD_123456_1`) when present, otherwise normalised `tender_ref`. Normalisation: trim, collapse whitespace, upper-case.

- Scope is per portal. The same ID on two portals is two opportunities; cross-portal similarity is a later "related opportunities" link, not identity.
- When a new sighting's identity matches, attach it and update `last_seen_at`, `latest_sighting_id`, and the copied columns.
- If closing date, value, or title differ from the previous sighting, record a `CHANGED` event with the before and after values. This is the first half of corrigendum detection.

**Open question (needs real data):** whether a GePNIC corrigendum keeps the same Tender ID, changes the trailing `_N`, or issues a new ID with the same reference number. Until confirmed, a same-`tender_ref` / different-ID pair is linked as `POSSIBLE_CORRIGENDUM_OF`, never merged.

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
  opportunity_id TEXT NOT NULL REFERENCES opportunities (id),
  kind TEXT NOT NULL,        -- SEEN, SCREENED, CHANGED, APPROVED, REJECTED, DEFERRED, REOPENED,
                             -- DOCUMENTS_COLLECTED, EXPIRED, NOTE
  actor TEXT NOT NULL,       -- 'automation' | 'user'
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

1. Create `opportunities` and `opportunity_events`, and add `tenders.opportunity_id`.
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

- Three groups, in this order: *Uncertain*, *Recommended*, *Rejected automatically* (collapsed).
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

## Open questions

1. How GePNIC represents corrigenda (see Identity). Needs one real corrigendum from TN Tenders.
2. Should an automatic REJECT still appear in the Inbox (collapsed), or only under Tenders → Rejected? This draft shows it collapsed so mistakes stay visible.
3. EXPIRED is time-based. Should it be computed on read or by a daily sweep at app start? This draft uses a sweep at app start, which writes events.
