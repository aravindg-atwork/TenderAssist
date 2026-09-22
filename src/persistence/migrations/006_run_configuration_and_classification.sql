CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE job_run_configs (
  job_id TEXT PRIMARY KEY,
  search_date TEXT NOT NULL,
  product_categories_json TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  excluded_keywords_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs (id)
);

ALTER TABLE tenders ADD COLUMN detail_product_category TEXT;
ALTER TABLE tenders ADD COLUMN tender_category TEXT;
ALTER TABLE tenders ADD COLUMN detail_text TEXT;
ALTER TABLE tenders ADD COLUMN detail_reviewed_at TEXT;

CREATE TABLE tender_classification_gates (
  id TEXT PRIMARY KEY,
  tender_id TEXT NOT NULL,
  gate TEXT NOT NULL CHECK (gate IN ('G1', 'G2', 'G3', 'G4')),
  result TEXT NOT NULL CHECK (result IN ('PASS', 'REJECT', 'UNCERTAIN', 'NOT_RUN')),
  reason_code TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  classifier_version TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  FOREIGN KEY (tender_id) REFERENCES tenders (id),
  UNIQUE (tender_id, gate)
);

CREATE INDEX idx_classification_gates_tender ON tender_classification_gates (tender_id);
