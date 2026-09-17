import type { DatabaseSync } from 'node:sqlite';
import type { AuthSessionRepository, AuthState } from '../persistence/repositories/authSessionRepository.js';
import type { StateTransitionRepository } from '../persistence/repositories/stateTransitionRepository.js';
import { withTransaction } from '../persistence/db.js';

const VALID_AUTH_TRANSITIONS: Record<AuthState, AuthState[]> = {
  NOT_STARTED: ['AUTH_PENDING'],
  AUTH_PENDING: ['AUTHENTICATED', 'SESSION_EXPIRED', 'TAB_LOST'],
  AUTHENTICATED: ['SESSION_EXPIRED', 'TAB_LOST'],
  SESSION_EXPIRED: [],
  TAB_LOST: [],
};

export class IllegalAuthTransitionError extends Error {
  constructor(from: AuthState, to: AuthState) {
    super(`Illegal auth session state transition: ${from} -> ${to}`);
    this.name = 'IllegalAuthTransitionError';
  }
}

export class AuthStateMachine {
  constructor(
    private db: DatabaseSync,
    private sessions: AuthSessionRepository,
    private transitions: StateTransitionRepository
  ) {}

  transition(authSessionId: string, to: AuthState, reason?: string): void {
    const session = this.sessions.getById(authSessionId);
    if (!session) throw new Error(`Auth session not found: ${authSessionId}`);

    const allowed = VALID_AUTH_TRANSITIONS[session.state] ?? [];
    if (!allowed.includes(to)) {
      throw new IllegalAuthTransitionError(session.state, to);
    }

    withTransaction(this.db, () => {
      this.sessions.updateState(authSessionId, to);
      if (to === 'AUTHENTICATED') {
        this.sessions.markAuthenticatedAt(authSessionId, new Date().toISOString());
      }
      this.transitions.record('AUTH_SESSION', authSessionId, session.state, to, reason);
    });
  }
}
