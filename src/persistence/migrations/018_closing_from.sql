-- A GeM catch-up search ("Bids with time to prepare", date_meaning
-- CLOSING_AFTER): the earliest closing day kept. Every open bid closing that
-- day or later is searched; search_date is the day the search ran.
ALTER TABLE job_run_configs ADD COLUMN closing_from TEXT;
