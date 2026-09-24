-- Tender-centric model: one opportunity per real tender, with the existing
-- per-job `tenders` rows kept as sightings. workspace_id / actor_id are
-- unused locally and exist so the schema can become multi-tenant later.
CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'local',
  portal_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  tender_portal_id TEXT,
  tender_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  organisation_chain TEXT,
  department TEXT,
  state_name TEXT,
  published_date TEXT,
  closing_date TEXT,
  closing_at TEXT,
  value_in_rupees TEXT,
  lifecycle TEXT NOT NULL,
  recommendation TEXT,
  changed_since_decision INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  latest_sighting_id TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, portal_id, identity_key)
);

CREATE INDEX idx_opportunities_lifecycle ON opportunities (workspace_id, lifecycle);

CREATE TABLE opportunity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'local',
  opportunity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('automation', 'operator')),
  actor_id TEXT,
  job_id TEXT,
  note TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities (id)
);

CREATE INDEX idx_opportunity_events_opp ON opportunity_events (opportunity_id, created_at);

CREATE TABLE opportunity_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'local',
  from_opportunity_id TEXT NOT NULL,
  to_opportunity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  confirmed_by_operator INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (from_opportunity_id) REFERENCES opportunities (id),
  FOREIGN KEY (to_opportunity_id) REFERENCES opportunities (id),
  UNIQUE (from_opportunity_id, to_opportunity_id, kind)
);

ALTER TABLE tenders ADD COLUMN opportunity_id TEXT REFERENCES opportunities (id);
CREATE INDEX idx_tenders_opportunity ON tenders (opportunity_id);

-- Runs acknowledged by the operator drop their auto-rejects from the Inbox.
-- Existing runs count as reviewed so the new Inbox starts clean.
ALTER TABLE jobs ADD COLUMN reviewed_at TEXT;
UPDATE jobs SET reviewed_at = updated_at;
