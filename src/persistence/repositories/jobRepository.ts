import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type JobState =
  | 'SCHEDULED'
  | 'AUTH_REQUIRED'
  | 'AUTH_PENDING'
  | 'AUTHENTICATED'
  | 'SEARCHING'
  | 'CLASSIFYING'
  | 'SHORTLISTED'
  | 'ACQUIRING_DOCUMENTS'
  | 'SESSION_EXPIRED'
  | 'DOCUMENTS_LOCAL'
  | 'PROCESSING_DOCUMENTS'
  | 'EXTRACTING_REQUIREMENTS'
  | 'UPLOADING'
  | 'REPORTING'
  | 'COMPLETE'
  | 'FAILED_RETRYABLE'
  | 'FAILED_MANUAL';

export interface JobRow {
  id: string;
  state: JobState;
  created_at: string;
  updated_at: string;
}

const TERMINAL_STATES: JobState[] = ['COMPLETE', 'FAILED_MANUAL'];

export class JobRepository {
  constructor(private db: DatabaseSync) {}

  create(): JobRow {
    const now = new Date().toISOString();
    const row: JobRow = { id: randomUUID(), state: 'SCHEDULED', created_at: now, updated_at: now };
    this.db
      .prepare(
        'INSERT INTO jobs (id, state, created_at, updated_at) VALUES (@id, @state, @created_at, @updated_at)'
      )
      .run(row);
    return row;
  }

  getById(id: string): JobRow | undefined {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  }

  updateState(id: string, state: JobState): void {
    this.db
      .prepare('UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, new Date().toISOString(), id);
  }

  findIncomplete(): JobRow | undefined {
    const placeholders = TERMINAL_STATES.map(() => '?').join(', ');
    return this.db
      .prepare(
        `SELECT * FROM jobs WHERE state NOT IN (${placeholders}) ORDER BY created_at DESC, rowid DESC LIMIT 1`
      )
      .get(...TERMINAL_STATES) as JobRow | undefined;
  }
}
