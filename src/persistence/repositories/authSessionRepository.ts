import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type AuthState = 'NOT_STARTED' | 'AUTH_PENDING' | 'AUTHENTICATED' | 'SESSION_EXPIRED' | 'TAB_LOST';

export interface AuthSessionRow {
  id: string;
  job_id: string;
  state: AuthState;
  cdp_target_id: string | null;
  authenticated_at: string | null;
  created_at: string;
  updated_at: string;
}

export class AuthSessionRepository {
  constructor(private db: DatabaseSync) {}

  create(jobId: string): AuthSessionRow {
    const now = new Date().toISOString();
    const row: AuthSessionRow = {
      id: randomUUID(),
      job_id: jobId,
      state: 'NOT_STARTED',
      cdp_target_id: null,
      authenticated_at: null,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO auth_sessions (id, job_id, state, cdp_target_id, authenticated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(row.id, row.job_id, row.state, row.cdp_target_id, row.authenticated_at, row.created_at, row.updated_at);
    return row;
  }

  getById(id: string): AuthSessionRow | undefined {
    return this.db.prepare('SELECT * FROM auth_sessions WHERE id = ?').get(id) as
      | AuthSessionRow
      | undefined;
  }

  getLatestForJob(jobId: string): AuthSessionRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM auth_sessions WHERE job_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
      )
      .get(jobId) as AuthSessionRow | undefined;
  }

  /** @internal Use AuthStateMachine.transition() instead — calling this directly skips transition validation and the audit-log write. */
  updateState(id: string, state: AuthState): void {
    this.db
      .prepare('UPDATE auth_sessions SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, new Date().toISOString(), id);
  }

  setCdpTargetId(id: string, targetId: string): void {
    this.db
      .prepare('UPDATE auth_sessions SET cdp_target_id = ?, updated_at = ? WHERE id = ?')
      .run(targetId, new Date().toISOString(), id);
  }

  markAuthenticatedAt(id: string, timestamp: string): void {
    this.db
      .prepare('UPDATE auth_sessions SET authenticated_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, new Date().toISOString(), id);
  }
}
