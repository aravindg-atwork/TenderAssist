-- A run is either a search of a published date, or a run that only collects
-- the documents of tenders the operator approved. A documents run lists the
-- tenders it worked on, which belong to the searches that found them.
ALTER TABLE jobs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'SEARCH';
ALTER TABLE jobs ADD COLUMN document_tender_ids_json TEXT;
