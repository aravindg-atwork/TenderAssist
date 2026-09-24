-- The operator's confirmed tender selection for document collection, so an
-- interrupted run can resume downloads without asking again. NULL means the
-- selection has not been confirmed yet.
ALTER TABLE job_run_configs ADD COLUMN selected_tender_ids_json TEXT;
