import type { Page } from 'playwright-core';
import type { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import type { AuthStateMachine } from '../state/authStateMachine.js';
import { BrowserController, type SessionLossReason } from './browserController.js';
import { isAuthenticatedDashboard } from './authDetector.js';
import { isSessionExpiredPage } from './sessionExpiredDetector.js';

export interface AuthFlowDeps {
  sessions: AuthSessionRepository;
  machine: AuthStateMachine;
}

export class AuthFlow {
  private controller: BrowserController | undefined;
  private authSessionId: string | undefined;

  constructor(private deps: AuthFlowDeps) {}

  async start(jobId: string, cdpEndpoint: string): Promise<{ authSessionId: string; targetId: string }> {
    const session = this.deps.sessions.create(jobId);
    this.authSessionId = session.id;

    this.controller = new BrowserController({
      cdpEndpoint,
      onSessionLost: (reason) => this.handleSessionLost(reason),
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
    return true;
  }

  getPage(): Page {
    if (!this.controller) throw new Error('AuthFlow.start() must be called before getPage()');
    return this.controller.getPage();
  }

  private handleSessionLost(reason: SessionLossReason): void {
    if (!this.authSessionId) return;
    const current = this.deps.sessions.getById(this.authSessionId);
    if (!current) return;
    if (current.state !== 'AUTH_PENDING' && current.state !== 'AUTHENTICATED') return;

    const target = reason === 'SESSION_EXPIRED_PAGE' ? 'SESSION_EXPIRED' : 'TAB_LOST';
    this.deps.machine.transition(this.authSessionId, target, `browser controller reported ${reason}`);
  }
}
