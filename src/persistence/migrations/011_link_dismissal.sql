-- The operator can say a suggested retender is not related. The row stays so
-- the suggestion is never made again for the same pair.
ALTER TABLE opportunity_links ADD COLUMN dismissed_at TEXT;
