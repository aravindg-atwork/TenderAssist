-- Why a category search failed after its retries, so a run can say which
-- categories may be missing tenders instead of skipping them silently.
ALTER TABLE searches ADD COLUMN last_error TEXT;
ALTER TABLE searches ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
