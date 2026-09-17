import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../src/persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { AuthStateMachine, IllegalAuthTransitionError } from '../../src/state/authStateMachine.js';

describe('AuthStateMachine', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let sessions: AuthSessionRepository;
  let transitions: StateTransitionRepository;
  let machine: AuthStateMachine;
  let jobId: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    sessions = new AuthSessionRepository(db);
    transitions = new StateTransitionRepository(db);
    machine = new AuthStateMachine(db, sessions, transitions);
    jobId = jobs.create().id;
  });

  it('allows NOT_STARTED -> AUTH_PENDING and records it in the audit log', () => {
    const session = sessions.create(jobId);
    machine.transition(session.id, 'AUTH_PENDING', 'human opened login page');

    expect(sessions.getById(session.id)?.state).toBe('AUTH_PENDING');
    const log = transitions.listFor('AUTH_SESSION', session.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      from_state: 'NOT_STARTED',
      to_state: 'AUTH_PENDING',
      reason: 'human opened login page',
    });
  });

  it('sets authenticated_at when transitioning to AUTHENTICATED', () => {
    const session = sessions.create(jobId);
    machine.transition(session.id, 'AUTH_PENDING');
    machine.transition(session.id, 'AUTHENTICATED');

    const fetched = sessions.getById(session.id)!;
    expect(fetched.state).toBe('AUTHENTICATED');
    expect(fetched.authenticated_at).not.toBeNull();
  });

  it('does not set authenticated_at for a non-AUTHENTICATED transition', () => {
    const session = sessions.create(jobId);
    machine.transition(session.id, 'AUTH_PENDING');

    expect(sessions.getById(session.id)?.authenticated_at).toBeNull();
  });

  it('rejects an invalid transition and leaves state unchanged', () => {
    const session = sessions.create(jobId);
    expect(() => machine.transition(session.id, 'AUTHENTICATED')).toThrow(IllegalAuthTransitionError);
    expect(sessions.getById(session.id)?.state).toBe('NOT_STARTED');
    expect(transitions.listFor('AUTH_SESSION', session.id)).toHaveLength(0);
  });

  it('rejects any transition out of a terminal state (SESSION_EXPIRED)', () => {
    const session = sessions.create(jobId);
    machine.transition(session.id, 'AUTH_PENDING');
    machine.transition(session.id, 'SESSION_EXPIRED');

    expect(() => machine.transition(session.id, 'AUTH_PENDING')).toThrow(IllegalAuthTransitionError);
  });

  it('throws for an unknown auth session id', () => {
    expect(() => machine.transition('missing-session', 'AUTH_PENDING')).toThrow(
      'Auth session not found: missing-session'
    );
  });

  it('allows AUTHENTICATED -> TAB_LOST', () => {
    const session = sessions.create(jobId);
    machine.transition(session.id, 'AUTH_PENDING');
    machine.transition(session.id, 'AUTHENTICATED');
    machine.transition(session.id, 'TAB_LOST');

    expect(sessions.getById(session.id)?.state).toBe('TAB_LOST');
  });
});
