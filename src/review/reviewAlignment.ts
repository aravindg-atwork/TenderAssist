import type { OpportunityLifecycle } from '../state/opportunityLifecycle.js';

// A tender's decision lives in two places: its status (the opportunity),
// which every decision updates, and the review saved with a run's answer,
// which the sheets, document downloads and counts read first. A decision
// made later (on Today or Tenders) must reach the review too, or the sheet
// and the downloads keep following the old answer.

/** Statuses that mean the operator approved the tender (and what followed). */
const APPROVED: readonly OpportunityLifecycle[] = ['APPROVED', 'DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'PREPARING', 'SUBMITTED', 'NOT_SUBMITTED', 'WON', 'LOST'];
/** Statuses that mean no decision yet: new, waiting, back to review, or later. */
const UNDECIDED: readonly OpportunityLifecycle[] = ['NEW', 'SCREENED', 'DEFERRED'];

/**
 * What a tender's review should say for its status: KEEP, REJECT, or null for
 * none (undecided again). 'LEAVE' for closed or cancelled tenders, whose last
 * decision stands.
 */
export function reviewForLifecycle(lifecycle: OpportunityLifecycle): 'KEEP' | 'REJECT' | null | 'LEAVE' {
  if (APPROVED.includes(lifecycle)) return 'KEEP';
  if (lifecycle === 'REJECTED') return 'REJECT';
  if (UNDECIDED.includes(lifecycle)) return null;
  return 'LEAVE';
}
