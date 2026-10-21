import type { DatabaseSync } from 'node:sqlite';

/** The bidder's ticks on a tender's checklist, and the reminders already shown. */
export class BidTrackingRepository {
  constructor(private db: DatabaseSync) {}

  ticks(opportunityId: string): Set<string> {
    const rows = this.db.prepare('SELECT item_key FROM bid_checklist_ticks WHERE opportunity_id = ?').all(opportunityId) as Array<{ item_key: string }>;
    return new Set(rows.map((row) => row.item_key));
  }

  setTick(opportunityId: string, itemKey: string, done: boolean, at = new Date().toISOString()): void {
    if (done) {
      this.db.prepare('INSERT INTO bid_checklist_ticks (opportunity_id, item_key, done_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(opportunityId, itemKey, at);
    } else {
      this.db.prepare('DELETE FROM bid_checklist_ticks WHERE opportunity_id = ? AND item_key = ?').run(opportunityId, itemKey);
    }
  }

  /** "opportunityId|reminderKey" of every reminder already shown. */
  sentReminders(): Set<string> {
    const rows = this.db.prepare('SELECT opportunity_id, reminder_key FROM reminders_sent').all() as Array<{ opportunity_id: string; reminder_key: string }>;
    return new Set(rows.map((row) => `${row.opportunity_id}|${row.reminder_key}`));
  }

  markReminderSent(opportunityId: string, reminderKey: string, at = new Date().toISOString()): void {
    this.db.prepare('INSERT INTO reminders_sent (opportunity_id, reminder_key, sent_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(opportunityId, reminderKey, at);
  }
}
