import type { JobRepository, JobState } from '../persistence/repositories/jobRepository.js';
import type { AuthSessionRepository, AuthState } from '../persistence/repositories/authSessionRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';
import type { AuthStateMachine } from '../state/authStateMachine.js';
import { AuthFlow } from '../browser/authFlow.js';
import { reactToAuthSessionLoss } from '../browser/authJobCoordinator.js';

export interface AuthJobRunnerDeps {
  jobs: JobRepository;
  sessions: AuthSessionRepository;
  jobMachine: JobStateMachine;
  authMachine: AuthStateMachine;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface AuthJobUpdate {
  jobId: string;
  authSessionId: string;
  jobState: JobState;
  authState: AuthState;
  outcome?: 'SUCCESS' | 'TIMEOUT' | 'ABORTED';
  abortReason?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
// When the retained tab is the browser's only open tab/window, closing it can
// take the whole Chrome process down with it (confirmed empirically: not
// just the one CDP target, but the entire browser-level connection). That
// races AuthFlow's own event-driven TAB_LOST/SESSION_EXPIRED transition
// (fired off a dedicated CDP session watching Target.targetDestroyed)
// against this loop's next checkAuthenticated() call landing on an
// already-dying browser -- which can surface as a raw transport error, or
// even as a call that never settles at all rather than rejecting promptly.
// This grace window gives the authoritative, already-in-flight state
// transition a moment to land so the real terminal reason (not a raw
// transport error, and not an indefinite hang) drives the outcome.
const SESSION_LOSS_GRACE_MS = 1000;
const SESSION_LOSS_GRACE_POLL_MS = 50;
// If checkAuthenticated() keeps failing/stalling tick after tick without the
// auth session ever reaching a terminal state (TAB_LOST/SESSION_EXPIRED),
// that's not the transient single-tick navigation race the grace window
// above exists for -- it's a genuinely broken/stuck check. Bounding this
// streak means a real failure still surfaces promptly with its diagnostic
// message, rather than being silently retried for the full outer timeoutMs
// (5 minutes by default) and reported as a generic, undiagnosable TIMEOUT.
const TRANSIENT_FAILURE_BUDGET_MS = 15000;
// Bounds a single CDP-backed call (checkAuthenticated(), the initial
// navigation) so a command sent to a troubled browser connection can't stall
// this function forever if it never settles -- observed in practice under
// heavier concurrent real-Chrome load (multiple browser-automation test
// files, or in production multiple concurrent auth jobs, each launching
// their own Chrome instance).
const CDP_CALL_TIMEOUT_MS = 5000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BoundedOutcome<T> = { kind: 'ok'; value: T } | { kind: 'error'; error: unknown } | { kind: 'stalled' };

/**
 * Races `promise` against `timeoutMs`. If the underlying promise eventually
 * settles after the timeout has already resolved this one as 'stalled', that
 * later settlement is swallowed here rather than surfacing as an unhandled
 * rejection. Used for any CDP-backed call in this file that could otherwise
 * hang indefinitely (rather than reject) if the browser connection is in
 * trouble -- observed in practice under heavier concurrent real-Chrome load.
 */
function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<BoundedOutcome<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: 'stalled' });
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({ kind: 'ok', value });
      },
      (error) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({ kind: 'error', error });
      }
    );
  });
}

type CheckOutcome = { kind: 'ok'; authenticated: boolean } | { kind: 'error'; error: unknown } | { kind: 'stalled' };

/** Runs flow.checkAuthenticated(), bounded by a timeout (see `bounded()`). */
async function checkAuthenticatedBounded(flow: AuthFlow, timeoutMs: number): Promise<CheckOutcome> {
  const result = await bounded(flow.checkAuthenticated(), timeoutMs);
  if (result.kind === 'ok') return { kind: 'ok', authenticated: result.value };
  return result;
}

/**
 * Polls the auth session for up to `timeoutMs` for it to reach a terminal
 * state (TAB_LOST/SESSION_EXPIRED), returning as soon as it does. Used after
 * a checkAuthenticated() failure/stall to give AuthFlow's own independent,
 * event-driven transition (fired off BrowserController's dedicated CDP
 * session) a moment to land before falling back to a raw error message.
 */
async function waitForTerminalAuthState(
  sessions: AuthSessionRepository,
  authSessionId: string,
  timeoutMs: number,
  pollMs: number
): Promise<AuthState> {
  const deadline = Date.now() + timeoutMs;
  let state = sessions.getById(authSessionId)!.state;
  while ((state === 'AUTH_PENDING' || state === 'AUTHENTICATED') && Date.now() < deadline) {
    await delay(pollMs);
    state = sessions.getById(authSessionId)!.state;
  }
  return state;
}

export async function runAuthJob(
  deps: AuthJobRunnerDeps,
  cdpEndpoint: string,
  portalUrl: string,
  onUpdate: (update: AuthJobUpdate) => void
): Promise<AuthJobUpdate> {
  const { jobs, sessions, jobMachine, authMachine } = deps;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const job = jobs.create();
  jobMachine.transition(job.id, 'AUTH_REQUIRED', 'UI-initiated auth job');

  const flow = new AuthFlow({
    sessions,
    machine: authMachine,
    onAuthSessionLost: reactToAuthSessionLoss(jobMachine, job.id),
  });
  // Bounded so a CDP attach that never settles (observed under heavier
  // concurrent real-Chrome load) surfaces as a clear, finite rejection
  // instead of leaving this function's promise hanging forever -- there's no
  // way to proceed without a successful attach, so this one does re-throw.
  const attachResult = await bounded(flow.start(job.id, cdpEndpoint), CDP_CALL_TIMEOUT_MS);
  if (attachResult.kind === 'error') throw attachResult.error;
  if (attachResult.kind === 'stalled') throw new Error('AuthFlow.start() did not settle in time');
  const { authSessionId } = attachResult.value;
  jobMachine.transition(job.id, 'AUTH_PENDING', 'browser attached');
  const initialNav = await bounded(flow.getPage().goto(portalUrl), CDP_CALL_TIMEOUT_MS);
  if (initialNav.kind === 'error' || initialNav.kind === 'stalled') {
    // This one-time convenience navigation can lose a race against another
    // navigation already in flight on the same tab -- e.g. Chrome's own
    // default-tab startup navigation, or (in real usage) the human already
    // clicking/navigating before this call lands -- or, under heavy
    // concurrent load, simply not settle promptly. It isn't load-bearing:
    // the polling loop below observes whatever the page currently shows
    // regardless of whether this specific navigation won its race. Only
    // re-throw if the tab/session is already confirmed gone for real.
    const state = sessions.getById(authSessionId)?.state;
    if (state === 'TAB_LOST' || state === 'SESSION_EXPIRED') {
      throw initialNav.kind === 'error' ? initialNav.error : new Error('initial navigation did not settle in time');
    }
  }

  const snapshot = (): AuthJobUpdate => ({
    jobId: job.id,
    authSessionId,
    jobState: jobs.getById(job.id)!.state,
    authState: sessions.getById(authSessionId)!.state,
  });

  let lastAuthState: AuthState = sessions.getById(authSessionId)!.state;
  onUpdate(snapshot());

  const deadline = Date.now() + timeoutMs;
  let outcome: 'SUCCESS' | 'TIMEOUT' | 'ABORTED' = 'TIMEOUT';
  let abortReason: string | undefined;
  // Tracks a run of consecutive checkAuthenticated() failures/stalls that
  // hasn't yet been resolved (by reaching a terminal auth state, or by a
  // clean tick in between). Reset to null whenever a tick comes back clean.
  let failureStreakStartedAt: number | null = null;
  let lastFailure: unknown = null;

  while (Date.now() < deadline) {
    const check = await checkAuthenticatedBounded(flow, CDP_CALL_TIMEOUT_MS);

    if (check.kind === 'error' || check.kind === 'stalled') {
      // checkAuthenticated() can fail transiently for a reason that has
      // nothing to do with the tab/session actually being lost: e.g. the
      // human's navigation to the dashboard (observed here via a second,
      // independent CDP connection -- browser2 in this file's own tests,
      // or a human's own browser interaction in real usage) destroys this
      // connection's JS execution context mid-innerText-call. That's a
      // routine, expected race with an in-flight poll, not a failure.
      //
      // The retained page/tab going away for real (e.g. the human closes
      // it, which can take the whole Chrome process down with it when it's
      // the browser's only open tab) is a DIFFERENT case, and AuthFlow's
      // BrowserController is watching for exactly that via its own
      // dedicated CDP session (Target.targetDestroyed etc.), independently
      // driving the auth session to TAB_LOST/SESSION_EXPIRED. That event
      // can simply take a moment longer than this specific check to land.
      //
      // So: give that authoritative, state-machine-recorded transition a
      // brief grace window. If it lands, this really was a terminal loss --
      // report ABORTED with that reason. If it doesn't, the tab is presumed
      // still alive (just transiently busy) -- treat this tick as
      // inconclusive and keep polling, rather than spuriously aborting a
      // run that's actually still headed for SUCCESS.
      if (failureStreakStartedAt === null) failureStreakStartedAt = Date.now();
      lastFailure = check.kind === 'error' ? check.error : new Error('checkAuthenticated() did not settle in time');

      const state = await waitForTerminalAuthState(sessions, authSessionId, SESSION_LOSS_GRACE_MS, SESSION_LOSS_GRACE_POLL_MS);
      if (state === 'TAB_LOST' || state === 'SESSION_EXPIRED') {
        outcome = 'ABORTED';
        abortReason = `auth session reached terminal state ${state} before authentication was detected`;
        break;
      }

      // The grace window didn't turn up a real terminal state. If this has
      // now been going on for TRANSIENT_FAILURE_BUDGET_MS with no clean
      // tick in between, this isn't a one-off race any more -- it's a
      // genuinely stuck/broken check. Surface it now, with the last real
      // error, instead of silently retrying for the rest of timeoutMs.
      if (Date.now() - failureStreakStartedAt >= TRANSIENT_FAILURE_BUDGET_MS) {
        outcome = 'ABORTED';
        const message = lastFailure instanceof Error ? lastFailure.message : String(lastFailure);
        abortReason = `checkAuthenticated() failed repeatedly: ${message}`;
        break;
      }

      await delay(pollIntervalMs);
      continue;
    }

    // A clean tick (even if not yet authenticated) means whatever was
    // causing prior failures has passed -- reset the streak so an old,
    // already-resolved hiccup can't count against a later, unrelated one.
    failureStreakStartedAt = null;
    lastFailure = null;

    if (check.authenticated) {
      outcome = 'SUCCESS';
      break;
    }

    const state = sessions.getById(authSessionId)!.state;
    if (state !== lastAuthState) {
      lastAuthState = state;
      onUpdate(snapshot());
    }

    if (state === 'TAB_LOST' || state === 'SESSION_EXPIRED') {
      outcome = 'ABORTED';
      abortReason = `auth session reached terminal state ${state} before authentication was detected`;
      break;
    }

    await delay(pollIntervalMs);
  }

  if (outcome === 'SUCCESS') {
    jobMachine.transition(job.id, 'AUTHENTICATED', 'auth flow confirmed dashboard indicators');
  }

  const final: AuthJobUpdate = { ...snapshot(), outcome, abortReason };
  onUpdate(final);
  return final;
}
