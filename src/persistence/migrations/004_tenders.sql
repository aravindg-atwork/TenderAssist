CREATE TABLE tenders (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  tender_ref TEXT NOT NULL,
  tender_portal_id TEXT,
  title TEXT NOT NULL,
  organisation_chain TEXT,
  published_date TEXT,
  closing_date TEXT,
  opening_date TEXT,
  product_category TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs (id),
  UNIQUE (job_id, tender_ref)
);

CREATE INDEX idx_tenders_job_id ON tenders (job_id);
