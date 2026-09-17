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
