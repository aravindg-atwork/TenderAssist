import type { InboxRow, OpportunityRepository, OpportunityRow } from '../persistence/repositories/opportunityRepository.js';
import type { OpportunityLifecycle } from '../state/opportunityLifecycle.js';
import { explainScreening, parseScreenedGates } from './tenderExplanation.js';
import { RETENDER_REASON_TEXT, retenderReason } from './relatedTenders.js';
import { describeChangesSinceDecision } from './timeline.js';

export type InboxGroup = 'UNCERTAIN' | 'RECOMMENDED' | 'CHANGED' | 'AUTO_REJECTED';

/** Another tender that may be the same work under a different Tender ID. */
export interface RelatedTender {
  id: string;
  tenderId: string;
  title: string;
  lifecycle: OpportunityLifecycle;
  /** RETENDER_OF: this tender is newer; RETENDERED_AS: the other one is. */
  direction: 'RETENDER_OF' | 'RETENDERED_AS';
  /** Plain words for why they look related. */
  reason: string;
}

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
  related: RelatedTender[];
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

type RelatedSource = Pick<OpportunityRepository, 'listRetenderLinks' | 'getById'>;

/** Possible retenders for every linked tender, keyed by tender. */
export function relatedTenders(opportunities: RelatedSource): Map<string, RelatedTender[]> {
  const index = new Map<string, RelatedTender[]>();
  const cache = new Map<string, OpportunityRow | undefined>();
  const load = (id: string) => {
    if (!cache.has(id)) cache.set(id, opportunities.getById(id));
    return cache.get(id);
  };
  const add = (owner: OpportunityRow, other: OpportunityRow, direction: RelatedTender['direction']) => {
    const reason = retenderReason(owner, other);
    const list = index.get(owner.id) ?? [];
    list.push({
      id: other.id,
      tenderId: other.tender_portal_id ?? other.tender_ref,
      title: other.title,
      lifecycle: other.lifecycle,
      direction,
      reason: reason ? RETENDER_REASON_TEXT[reason] : 'looked similar when it was found',
    });
    index.set(owner.id, list);
  };
  for (const link of opportunities.listRetenderLinks()) {
    const newer = load(link.from_opportunity_id);
    const older = load(link.to_opportunity_id);
    if (!newer || !older) continue;
    add(newer, older, 'RETENDER_OF');
    add(older, newer, 'RETENDERED_AS');
  }
  return index;
}

export function summarizeTender(row: InboxRow, related: RelatedTender[] = []): TenderSummary {
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
    related,
  };
}

function toItem(row: InboxRow, group: InboxGroup, related: RelatedTender[], changes: () => string | null): InboxItem {
  const summary = summarizeTender(row, related);
  return {
    ...summary,
    group,
    explanation: group === 'CHANGED' ? changes() ?? 'Changed since your decision: dates, value, or a corrigendum.' : summary.explanation,
  };
}

export function buildInbox(opportunities: Pick<OpportunityRepository, 'listInboxRows' | 'listEvents'> & RelatedSource): InboxView {
  const view: InboxView = { uncertain: [], recommended: [], changed: [], autoRejected: [], attentionCount: 0 };
  const related = relatedTenders(opportunities);
  for (const row of opportunities.listInboxRows()) {
    const group = groupFor(row);
    if (!group) continue;
    const item = toItem(row, group, related.get(row.id) ?? [], () => describeChangesSinceDecision(opportunities.listEvents(row.id)));
    if (group === 'UNCERTAIN') view.uncertain.push(item);
    else if (group === 'RECOMMENDED') view.recommended.push(item);
    else if (group === 'CHANGED') view.changed.push(item);
    else view.autoRejected.push(item);
  }
  view.attentionCount = view.uncertain.length + view.recommended.length + view.changed.length;
  return view;
}
