-- What the bidder has ticked off for an approved tender (21 Oct 2026). The
-- checklist itself is worked out from the tender each time it is shown; only
-- the ticks are kept, by a key made from the item's wording.
CREATE TABLE bid_checklist_ticks (
  opportunity_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  done_at TEXT NOT NULL,
  PRIMARY KEY (opportunity_id, item_key),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities (id)
);

-- Reminders already shown (pre-bid meeting, closing soon), so each shows once.
CREATE TABLE reminders_sent (
  opportunity_id TEXT NOT NULL,
  reminder_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (opportunity_id, reminder_key),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities (id)
);
