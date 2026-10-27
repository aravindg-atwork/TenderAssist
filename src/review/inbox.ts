import type { InboxRow, OpportunityRepository, OpportunityRow } from '../persistence/repositories/opportunityRepository.js';
import type { OpportunityLifecycle } from '../state/opportunityLifecycle.js';
import { explainScreening, parseScreenedGates } from './tenderExplanation.js';
import { RETENDER_REASON_TEXT, retenderReason } from './relatedTenders.js';
import { describeChangesSinceDecision } from './timeline.js';
import { chosenOrganisationOf } from '../config/runConfiguration.js';
import type { QualifyReport } from './qualifyCheck.js';
import { tenderInterest, type InterestHistory, type InterestScore, type ScoreBand, type ScoreReason } from './interestScore.js';
import type { SimilarTender } from './tenderSimilarity.js';

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
  /** When the portal published it, as stored (ISO with offset). */
  publishedDate: string | null;
  /** When TenderAssist last screened it; dates its note on the file. */
  screenedAt: string;
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
  /** How well it fits the office's interest, 0 to 100 (Today only); ranks and explains, never decides. */
  score?: number;
  scoreBand?: ScoreBand;
  scoreReasons?: ScoreReason[];
  /** Approved or won tenders it looks like. */
  similarTo?: SimilarTender[];
}

/**
 * Why the rules rejected a tender, for the one-step check on Today:
 * in a chosen category but without an intent word, with an excluded word, or else.
 */
export type RuleRejectKind = 'NO_INTENT' | 'EXCLUDED' | 'OTHER';

export interface InboxItem extends TenderSummary {
  group: InboxGroup;
  /** For a rule reject only. */
  rejectKind?: RuleRejectKind;
  /** One of the operator's chosen organisations (Settings), whose tenders come first in each group. */
  favouredOrganisation?: string;
}

/** The screening check that decided a reject, by its gates. */
function ruleRejectKind(row: InboxRow): RuleRejectKind | 'OUTSIDE_CATEGORIES' {
  const gates = parseScreenedGates(row.screening_json);
  const failed = (gate: string) => gates.find((entry) => entry.gate === gate && entry.result === 'REJECT');
  if (failed('G2')) return 'OUTSIDE_CATEGORIES';
  if (failed('G4')) return 'EXCLUDED';
  if (failed('G3')?.reasonCode === 'NO_INTENT_KEYWORD_MATCH') return 'NO_INTENT';
  return 'OTHER';
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
    // that they live only under Tenders → Rejected. Tenders outside the chosen
    // categories never come to Today (GeM's thousands a day): only there.
    if (ruleRejectKind(row) === 'OUTSIDE_CATEGORIES') return null;
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
    publishedDate: row.published_date,
    screenedAt: row.screening_at ?? row.last_seen_at,
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
    ...(group === 'AUTO_REJECTED' ? { rejectKind: ruleRejectKind(row) as RuleRejectKind } : {}),
  };
}

/** What the interest score reads besides the tender's own screening. */
export interface InboxInterest {
  /** What the office approved and won before. */
  history?: InterestHistory | null;
  /** The tender's work description and "Do we qualify?", when known. */
  detailsOf?: (row: InboxRow, group: InboxGroup | null) => { description?: string | null; qualify?: QualifyReport | null };
  now?: Date;
}

/** A tender's interest score, from its latest screening and the office's history. */
export function interestOfRow(row: InboxRow, interest: InboxInterest = {}, favouredOrganisation: string | null = null, group: InboxGroup | null = null): InterestScore {
  const details = interest.detailsOf?.(row, group) ?? {};
  return tenderInterest({
    id: row.id,
    title: row.title,
    description: details.description,
    gates: parseScreenedGates(row.screening_json),
    favouredOrganisation,
    organisation: row.organisation_chain,
    department: row.department,
    closingAt: row.closing_at,
    value: row.value_in_rupees,
    qualify: details.qualify,
  }, interest.history ?? null, interest.now);
}

export function buildInbox(
  opportunities: Pick<OpportunityRepository, 'listInboxRows' | 'listEvents'> & RelatedSource,
  /** Each website's chosen organisations: their tenders are of more interest (owner, 27 Oct 2026). */
  organisationsFor?: (portalId: string) => readonly string[],
  interest: InboxInterest = {},
): InboxView {
  const view: InboxView = { uncertain: [], recommended: [], changed: [], autoRejected: [], attentionCount: 0 };
  const related = relatedTenders(opportunities);
  for (const row of opportunities.listInboxRows()) {
    const group = groupFor(row);
    if (!group) continue;
    const item = toItem(row, group, related.get(row.id) ?? [], () => describeChangesSinceDecision(opportunities.listEvents(row.id)));
    const favoured = chosenOrganisationOf([row.organisation_chain, row.department], organisationsFor?.(row.portal_id));
    if (favoured) item.favouredOrganisation = favoured;
    const fit = interestOfRow(row, interest, favoured, group);
    Object.assign(item, { score: fit.score, scoreBand: fit.band, scoreReasons: fit.reasons, similarTo: fit.similarTo });
    if (group === 'UNCERTAIN') view.uncertain.push(item);
    else if (group === 'RECOMMENDED') view.recommended.push(item);
    else if (group === 'CHANGED') view.changed.push(item);
    else view.autoRejected.push(item);
  }
  // A chosen organisation's tenders first, then the best fit; equal ones keep their closing order.
  for (const items of [view.uncertain, view.recommended, view.changed, view.autoRejected]) {
    items.sort((a, b) => Number(Boolean(b.favouredOrganisation)) - Number(Boolean(a.favouredOrganisation)) || (b.score ?? 0) - (a.score ?? 0));
  }
  view.attentionCount = view.uncertain.length + view.recommended.length + view.changed.length;
  return view;
}
