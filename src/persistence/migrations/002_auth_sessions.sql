CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  state TEXT NOT NULL,
  cdp_target_id TEXT,
  authenticated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs (id)
);

CREATE INDEX idx_auth_sessions_job_id ON auth_sessions (job_id);
