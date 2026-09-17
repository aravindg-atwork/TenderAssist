import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface StateTransitionRow {
  id: string;
  entity_type: string;
  entity_id: string;
  from_state: string | null;
  to_state: string;
  reason: string | null;
  occurred_at: string;
}

export class StateTransitionRepository {
  constructor(private db: DatabaseSync) {}

  record(
    entityType: string,
    entityId: string,
    fromState: string | null,
    toState: string,
    reason?: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO state_transitions (id, entity_type, entity_id, from_state, to_state, reason, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), entityType, entityId, fromState, toState, reason ?? null, new Date().toISOString());
  }

  listFor(entityType: string, entityId: string): StateTransitionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM state_transitions WHERE entity_type = ? AND entity_id = ? ORDER BY occurred_at ASC`
      )
      .all(entityType, entityId) as StateTransitionRow[];
  }
}
