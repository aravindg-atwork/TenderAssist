CREATE TABLE searches (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  search_key TEXT NOT NULL,
  product_category TEXT NOT NULL,
  state TEXT NOT NULL,
  current_page INTEGER NOT NULL DEFAULT 0,
  result_count INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs (id),
  UNIQUE (job_id, search_key)
);

CREATE INDEX idx_searches_job_id ON searches (job_id);
