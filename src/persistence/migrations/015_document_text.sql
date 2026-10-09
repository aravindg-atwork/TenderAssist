-- The text inside each downloaded document: read directly from a PDF, or by
-- Windows' OCR for scanned pages and images. Used to find a tender's
-- requirements (EMD, eligibility, scope) and the operator's words.
ALTER TABLE tender_documents ADD COLUMN text_content TEXT;
ALTER TABLE tender_documents ADD COLUMN text_method TEXT;
ALTER TABLE tender_documents ADD COLUMN text_pages INTEGER;
ALTER TABLE tender_documents ADD COLUMN text_ocr_pages INTEGER;
ALTER TABLE tender_documents ADD COLUMN text_read_at TEXT;
