-- What a run's date means: PUBLISHED (the day tenders were published; a GeM
-- bid's start) or CLOSING (GeM only: the day bids close). Runs before this
-- were all published-date runs.
ALTER TABLE job_run_configs ADD COLUMN date_meaning TEXT NOT NULL DEFAULT 'PUBLISHED';
