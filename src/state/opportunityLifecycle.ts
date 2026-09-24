import { IllegalTransitionError } from './errors.js';

// Tender state, separate from job state and portal/auth state. See
// docs/superpowers/specs/2026-09-24-tender-centric-model-and-inbox-design.md.
export type OpportunityLifecycle =
  | 'NEW'
  | 'SCREENED'
  | 'APPROVED'
  | 'REJECTED'
  | 'DEFERRED'
  | 'DOCUMENTS_COLLECTED'
  | 'ELIGIBILITY_REVIEWED'
  | 'PREPARING'
  | 'SUBMITTED'
  | 'NOT_SUBMITTED'
  | 'WON'
  | 'LOST'
  | 'EXPIRED'
  | 'CANCELLED';

export type OperatorDecision = 'APPROVE' | 'REJECT' | 'DEFER' | 'REOPEN';

const VALID_TRANSITIONS: Record<OpportunityLifecycle, OpportunityLifecycle[]> = {
  NEW: ['SCREENED', 'APPROVED', 'REJECTED', 'DEFERRED', 'EXPIRED', 'CANCELLED'],
  SCREENED: ['APPROVED', 'REJECTED', 'DEFERRED', 'EXPIRED', 'CANCELLED'],
  DEFERRED: ['SCREENED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  APPROVED: ['DOCUMENTS_COLLECTED', 'SCREENED', 'REJECTED', 'DEFERRED', 'EXPIRED', 'CANCELLED'],
  REJECTED: ['SCREENED', 'APPROVED', 'CANCELLED'],
  DOCUMENTS_COLLECTED: ['ELIGIBILITY_REVIEWED', 'SCREENED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  ELIGIBILITY_REVIEWED: ['PREPARING', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  PREPARING: ['SUBMITTED', 'NOT_SUBMITTED', 'EXPIRED', 'CANCELLED'],
  SUBMITTED: ['WON', 'LOST', 'CANCELLED'],
  NOT_SUBMITTED: [],
  WON: [],
  LOST: [],
  // A corrigendum can extend the deadline of an expired tender.
  EXPIRED: ['SCREENED', 'CANCELLED'],
  CANCELLED: [],
};

/** States whose closing date still matters; the expiry sweep only touches these. */
export const OPEN_LIFECYCLES: readonly OpportunityLifecycle[] = [
  'NEW', 'SCREENED', 'DEFERRED', 'APPROVED', 'DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'PREPARING',
];

/** States where the operator has made a call; later changes flag the tender for another look. */
export const DECIDED_LIFECYCLES: readonly OpportunityLifecycle[] = [
  'APPROVED', 'REJECTED', 'DEFERRED', 'DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'PREPARING',
];

export const DECISION_TARGETS: Record<OperatorDecision, OpportunityLifecycle> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  DEFER: 'DEFERRED',
  REOPEN: 'SCREENED',
};

export class IllegalOpportunityTransitionError extends IllegalTransitionError {
  constructor(from: OpportunityLifecycle, to: OpportunityLifecycle) {
    super(`Illegal tender lifecycle transition: ${from} -> ${to}`);
    this.name = 'IllegalOpportunityTransitionError';
  }
}

export function canTransition(from: OpportunityLifecycle, to: OpportunityLifecycle): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OpportunityLifecycle, to: OpportunityLifecycle): void {
  if (!canTransition(from, to)) throw new IllegalOpportunityTransitionError(from, to);
}
