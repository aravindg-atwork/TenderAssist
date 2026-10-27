-- A published-day search that reads only tenders published at or after this
-- Indian time of the day (HH:MM): the time the day was last searched, or the
-- operator's own choice on Today. NULL is the whole day.
ALTER TABLE job_run_configs ADD COLUMN from_time TEXT;
