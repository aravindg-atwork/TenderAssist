import type { Page } from 'playwright-core';
import type { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import type { AuthStateMachine } from '../state/authStateMachine.js';
import { BrowserController, type SessionLossReason } from './browserController.js';
import { isAuthenticatedDashboard } from './authDetector.js';
import { isSessionExpiredPage } from './sessionExpiredDetector.js';
import { preparePortalLogin, refillVisiblePortalLogin, type AssistedLoginStep, type PortalCredentials } from './portalLoginController.js';
import type { DscJnlpArtifact } from './dscDownloadSecurity.js';
import { detectPortalAuthIssue, type PortalAuthIssue } from './portalAuthIssueDetector.js';
import { clickDscLoginIfAvailable } from './dscLoginController.js';
import type { PaceAction } from '../orchestration/actionPacer.js';

export interface AuthFlowDeps {
  sessions: AuthSessionRepository;
  machine: AuthStateMachine;
  onAuthSessionLost?: (reason: SessionLossReason, terminalState: 'TAB_LOST' | 'SESSION_EXPIRED') => void;
  dscDownloadDirectory?: string;
  onDscJnlpReady?: (artifact: DscJnlpArtifact) => void;
  targetUrlPrefix?: string;
  paceAction?: PaceAction;
}

export class AuthFlow {
  private controller: BrowserController | undefined;
  private authSessionId: string | undefined;
  private dscLoginStarted = false;
  // A click still in progress (it pauses first): a second click would make
  // the portal issue a newer signer file and reject the first one.
  private dscLoginInProgress = false;

  constructor(private deps: AuthFlowDeps) {}

  async start(jobId: string, cdpEndpoint: string): Promise<{ authSessionId: string; targetId: string }> {
    const session = this.deps.sessions.create(jobId);
    this.authSessionId = session.id;

    this.controller = new BrowserController({
      cdpEndpoint,
      targetUrlPrefix: this.deps.targetUrlPrefix,
      onSessionLost: (reason) => this.handleSessionLost(reason),
      dscDownloadDirectory: this.deps.dscDownloadDirectory,
      onDscJnlpReady: this.deps.onDscJnlpReady,
    });
    const { targetId } = await this.controller.attach();

    this.deps.sessions.setCdpTargetId(session.id, targetId);
    this.deps.machine.transition(session.id, 'AUTH_PENDING', 'browser attached, awaiting human login');

    return { authSessionId: session.id, targetId };
  }

  async checkAuthenticated(): Promise<boolean> {
    if (!this.controller || !this.authSessionId) {
      throw new Error('AuthFlow.start() must be called before checkAuthenticated()');
    }
    const current = this.deps.sessions.getById(this.authSessionId);
    if (!current || current.state !== 'AUTH_PENDING') return false;

    const text = await this.controller.extractPageText();
    // Spec precedence: expiry wins whenever both detectors would match. Checked
    // here explicitly, off the same text snapshot, rather than relying on the
    // controller's separate async framenavigated handler having already landed
    // the SESSION_EXPIRED transition by the time this poll runs.
    if (isSessionExpiredPage(this.controller.getPage().url(), text)) return false;
    if (!isAuthenticatedDashboard(text)) return false;

    this.deps.machine.transition(this.authSessionId, 'AUTHENTICATED', 'dashboard indicators detected');
    this.controller.markSignedIn();
    return true;
  }

  async prepareLogin(credentials?: PortalCredentials): Promise<AssistedLoginStep> {
    if (!this.controller) throw new Error('AuthFlow.start() must be called before prepareLogin()');
    return preparePortalLogin(this.controller.getPage(), credentials, this.deps.paceAction);
  }

  async refillVisibleLogin(credentials: PortalCredentials): Promise<boolean> {
    if (!this.controller) throw new Error('AuthFlow.start() must be called before refillVisibleLogin()');
    const refilled = await refillVisiblePortalLogin(this.controller.getPage(), credentials, this.deps.paceAction);
    if (refilled) this.dscLoginStarted = false;
    return refilled;
  }

  async detectAuthIssue(): Promise<PortalAuthIssue | null> {
    if (!this.controller) throw new Error('AuthFlow.start() must be called before detectAuthIssue()');
    return detectPortalAuthIssue(await this.controller.extractPageText());
  }

  async startDscLoginIfAvailable(): Promise<boolean> {
    if (!this.controller) throw new Error('AuthFlow.start() must be called before startDscLoginIfAvailable()');
    if (this.dscLoginStarted || this.dscLoginInProgress) return false;
    this.dscLoginInProgress = true;
    try {
      const started = await clickDscLoginIfAvailable(this.controller.getPage(), this.deps.paceAction);
      if (started) this.dscLoginStarted = true;
      return started;
    } finally {
      this.dscLoginInProgress = false;
    }
  }

  /** Lets DSC Login be clicked again, to get a fresh signer file. */
  allowDscLoginAgain(): void {
    this.dscLoginStarted = false;
  }

  getPage(): Page {
    if (!this.controller) throw new Error('AuthFlow.start() must be called before getPage()');
    return this.controller.getPage();
  }

  /**
   * Stops reacting to tab-close/target-destroy events. Call once the flow has
   * reached a terminal outcome (SUCCESS/TIMEOUT/ABORTED) and the caller may
   * go on to deliberately close the browser (e.g. to free the profile lock
   * for the next job) -- without this, that deliberate close is reported as
   * a session loss and overwrites the already-terminal auth state.
   */
  stop(): void {
    this.controller?.dispose();
  }

  private handleSessionLost(reason: SessionLossReason): void {
    if (!this.authSessionId) return;
    const current = this.deps.sessions.getById(this.authSessionId);
    if (!current) return;
    if (current.state !== 'AUTH_PENDING' && current.state !== 'AUTHENTICATED') return;

    const target = reason === 'SESSION_EXPIRED_PAGE' || reason === 'SIGNED_OUT' ? 'SESSION_EXPIRED' : 'TAB_LOST';
    this.deps.machine.transition(this.authSessionId, target, `browser controller reported ${reason}`);
    this.deps.onAuthSessionLost?.(reason, target);
  }
}
