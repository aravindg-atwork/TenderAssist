-- The organisations a run searched as well as its categories (Settings,
-- per website), as a JSON list. NULL is none.
ALTER TABLE job_run_configs ADD COLUMN organisations_json TEXT;
