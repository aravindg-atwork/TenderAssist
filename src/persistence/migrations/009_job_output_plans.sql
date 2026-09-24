-- Freezes where each job publishes, so later folder-template changes never
-- move an existing job, and numbers tenders per day folder so several jobs
-- on the same date never overwrite one another.
--
-- No foreign keys on purpose: rows outlive a deleted job because its folders
-- stay on disk, and reusing its run or serial numbers would overwrite them.
CREATE TABLE job_output_plans (
  job_id TEXT PRIMARY KEY,
  output_root TEXT NOT NULL,
  output_date TEXT NOT NULL,
  structure_json TEXT NOT NULL,
  directory_key TEXT NOT NULL,
  run_number INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (directory_key, run_number)
);

CREATE TABLE job_output_tenders (
  tender_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  directory_key TEXT NOT NULL,
  serial_number INTEGER NOT NULL,
  UNIQUE (directory_key, serial_number)
);
