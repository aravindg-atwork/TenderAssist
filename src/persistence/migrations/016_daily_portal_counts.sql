-- How many tenders a website published on a day, all categories together,
-- for the daily report. Tamil Nadu: counted from the public "Tenders by
-- Organisation" pages (open tenders only, so the highest count seen is kept).
-- GeM: every bid that started that day, with a count per GeM category.
CREATE TABLE daily_portal_counts (
  portal_id TEXT NOT NULL,
  published_date TEXT NOT NULL,
  total_published INTEGER NOT NULL,
  categories_json TEXT,
  source TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (portal_id, published_date)
);
