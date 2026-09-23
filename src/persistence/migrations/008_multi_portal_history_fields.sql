ALTER TABLE job_run_configs ADD COLUMN portal_id TEXT NOT NULL DEFAULT 'tamil-nadu';
ALTER TABLE tenders ADD COLUMN department TEXT;
ALTER TABLE tenders ADD COLUMN state_name TEXT;
CREATE INDEX idx_job_run_configs_portal_date ON job_run_configs (portal_id, search_date);
