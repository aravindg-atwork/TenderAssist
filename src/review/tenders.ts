import type { OpportunityRepository } from '../persistence/repositories/opportunityRepository.js';
import type { OpportunityLifecycle } from '../state/opportunityLifecycle.js';
import { relatedTenders, summarizeTender, type TenderSummary } from './inbox.js';

export interface TendersView {
  approved: TenderSummary[];
  deferred: TenderSummary[];
  rejected: TenderSummary[];
  /** Undecided tenders kept out of the Inbox, such as history from before it existed. */
  earlier: TenderSummary[];
  closed: TenderSummary[];
}

type Bucket = keyof TendersView;

const BUCKETS: Record<OpportunityLifecycle, Bucket> = {
  NEW: 'earlier',
  SCREENED: 'earlier',
  APPROVED: 'approved',
  DOCUMENTS_COLLECTED: 'approved',
  ELIGIBILITY_REVIEWED: 'approved',
  PREPARING: 'approved',
  DEFERRED: 'deferred',
  REJECTED: 'rejected',
  SUBMITTED: 'closed',
  NOT_SUBMITTED: 'closed',
  WON: 'closed',
  LOST: 'closed',
  EXPIRED: 'closed',
  CANCELLED: 'closed',
};

/** Every tender grouped by where it is in its life. Tenders waiting in the Inbox stay there. */
export function buildTenders(opportunities: Pick<OpportunityRepository, 'listAllWithScreening' | 'listRetenderLinks' | 'getById'>): TendersView {
  const view: TendersView = { approved: [], deferred: [], rejected: [], earlier: [], closed: [] };
  const related = relatedTenders(opportunities);
  for (const row of opportunities.listAllWithScreening()) {
    const bucket = BUCKETS[row.lifecycle];
    if (bucket === 'earlier' && row.inbox_hidden_at === null) continue;
    view[bucket].push(summarizeTender(row, related.get(row.id) ?? []));
  }
  return view;
}
