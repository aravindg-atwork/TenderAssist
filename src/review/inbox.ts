import type { InboxRow, OpportunityRepository } from '../persistence/repositories/opportunityRepository.js';
import type { OpportunityLifecycle } from '../state/opportunityLifecycle.js';
import { explainScreening, parseScreenedGates } from './tenderExplanation.js';

export type InboxGroup = 'UNCERTAIN' | 'RECOMMENDED' | 'CHANGED' | 'AUTO_REJECTED';

/** What every tender list shows about a tender. */
export interface TenderSummary {
  id: string;
  portalId: string;
  tenderId: string;
  reference: string;
  title: string;
  organisation: string | null;
  department: string | null;
  closingDate: string | null;
  /** UTC ISO; the UI renders it relative to now. */
  closingAt: string | null;
  value: string | null;
  lifecycle: OpportunityLifecycle;
  recommendation: 'KEEP' | 'REJECT' | 'UNCERTAIN' | null;
  explanation: string;
  matchedExclusions: string[];
  lastSeenAt: string;
  /** Run whose screening put it here; acknowledging that run clears its auto-rejects. */
  screeningJobId: string | null;
  changedSinceDecision: boolean;
}

export interface InboxItem extends TenderSummary {
  group: InboxGroup;
}

export interface InboxView {
  uncertain: InboxItem[];
  recommended: InboxItem[];
  changed: InboxItem[];
  autoRejected: InboxItem[];
  /** Items needing a decision (excludes the collapsed auto-reject group). */
  attentionCount: number;
}

function groupFor(row: InboxRow): InboxGroup | null {
  if (row.lifecycle !== 'NEW' && row.lifecycle !== 'SCREENED') return row.changed_since_decision ? 'CHANGED' : null;
  if (row.recommendation === 'KEEP') return 'RECOMMENDED';
  const reopenedByOperator = row.reopened_at !== null && (row.screening_at === null || row.reopened_at >= row.screening_at);
  if (row.recommendation === 'REJECT' && !reopenedByOperator) {
    // Auto-rejects stay visible until their run is acknowledged; after
    // that they live only under Tenders → Rejected.
    return row.screening_job_reviewed_at ? null : 'AUTO_REJECTED';
  }
  return 'UNCERTAIN';
}

export function summarizeTender(row: InboxRow): TenderSummary {
  const explanation = explainScreening(row.recommendation, parseScreenedGates(row.screening_json));
  return {
    id: row.id,
    portalId: row.portal_id,
    tenderId: row.tender_portal_id ?? row.tender_ref,
    reference: row.tender_ref,
    title: row.title,
    organisation: row.organisation_chain,
    department: row.department,
    closingDate: row.closing_date,
    closingAt: row.closing_at,
    value: row.value_in_rupees,
    lifecycle: row.lifecycle,
    recommendation: row.recommendation,
    explanation: explanation.sentence,
    matchedExclusions: explanation.matchedExclusions,
    lastSeenAt: row.last_seen_at,
    screeningJobId: row.screening_job_id,
    changedSinceDecision: row.changed_since_decision === 1,
  };
}

function toItem(row: InboxRow, group: InboxGroup): InboxItem {
  const summary = summarizeTender(row);
  return {
    ...summary,
    group,
    explanation: group === 'CHANGED' ? 'Changed since your decision: dates, value, or a corrigendum.' : summary.explanation,
  };
}

export function buildInbox(opportunities: Pick<OpportunityRepository, 'listInboxRows'>): InboxView {
  const view: InboxView = { uncertain: [], recommended: [], changed: [], autoRejected: [], attentionCount: 0 };
  for (const row of opportunities.listInboxRows()) {
    const group = groupFor(row);
    if (!group) continue;
    const item = toItem(row, group);
    if (group === 'UNCERTAIN') view.uncertain.push(item);
    else if (group === 'RECOMMENDED') view.recommended.push(item);
    else if (group === 'CHANGED') view.changed.push(item);
    else view.autoRejected.push(item);
  }
  view.attentionCount = view.uncertain.length + view.recommended.length + view.changed.length;
  return view;
}
