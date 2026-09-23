ALTER TABLE tenders ADD COLUMN document_links_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE tender_reviews (
  tender_id TEXT PRIMARY KEY,
  decision TEXT NOT NULL CHECK (decision IN ('KEEP', 'REJECT')),
  reason TEXT,
  decided_at TEXT NOT NULL,
  FOREIGN KEY (tender_id) REFERENCES tenders (id)
);

CREATE TABLE tender_documents (
  id TEXT PRIMARY KEY,
  tender_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  local_path TEXT,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'DOWNLOADED', 'FAILED')),
  checksum_sha256 TEXT,
  error TEXT,
  downloaded_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tender_id) REFERENCES tenders (id),
  UNIQUE (tender_id, source_url)
);

CREATE INDEX idx_tender_documents_tender ON tender_documents (tender_id);

CREATE TABLE tender_requirements (
  tender_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  extracted_at TEXT NOT NULL,
  FOREIGN KEY (tender_id) REFERENCES tenders (id)
);
