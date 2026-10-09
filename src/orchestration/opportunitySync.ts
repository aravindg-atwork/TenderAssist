import type { TenderRepository } from '../persistence/repositories/tenderRepository.js';
import type { ClassificationRepository } from '../persistence/repositories/classificationRepository.js';
import type { TenderWorkflowRepository } from '../persistence/repositories/tenderWorkflowRepository.js';
import type { OpportunityRepository } from '../persistence/repositories/opportunityRepository.js';
import { canTransition, DECISION_TARGETS, type OperatorDecision } from '../state/opportunityLifecycle.js';
import { screeningEvidence } from '../review/tenderExplanation.js';
import { retenderReason } from '../review/relatedTenders.js';
import { applyPortalCorrigenda } from '../review/corrigenda.js';
import { tenderPageFacts } from '../review/watchedTenders.js';

// Bridges run-level rows (`tenders`, gates, reviews) to durable tender
// records. Every function is idempotent, so a phase can call it again after
// a retry without duplicating history.

export interface OpportunitySyncDeps {
  tenders: TenderRepository;
  classifications: ClassificationRepository;
  opportunities: OpportunityRepository;
}

/**
 * Records every tender the run has seen. With `screening`, also stores the
 * automatic recommendation; pass it only once all gates have run, or a
 * half-classified tender would be logged as UNCERTAIN.
 */
export function syncJobOpportunities(deps: OpportunitySyncDeps, jobId: string, portalId: string, options: { screening: boolean }): void {
  const seen = new Set<string>();
  for (const tender of deps.tenders.listForJob(jobId)) {
    const opportunity = syncTenderSighting(deps, tender, portalId, { jobId });
    seen.add(opportunity.id);
    if (!options.screening) continue;
    const final = deps.classifications.getFinalForTender(tender.id);
    if (final === 'NOT_RUN') continue;
    deps.opportunities.recordScreening(opportunity.id, final, { jobId }, { ...screeningEvidence(deps.classifications.listForTender(tender.id)) });
  }
  linkPossibleRetenders(deps, portalId, seen);
}

/**
 * Records the corrigenda listed on a tender's own page (GePNIC's "Latest
 * Corrigendum List"). Each is recorded once; a new one on a tender the
 * operator decided brings it back as "Changed since you decided".
 */
export function recordPageCorrigenda(
  deps: Pick<OpportunitySyncDeps, 'opportunities'>,
  opportunityId: string,
  detailText: string | null,
  context: { jobId?: string | null; at?: string } = {},
  options: { flagDecided?: boolean } = {}
): number {
  const { corrigenda } = tenderPageFacts(detailText);
  return corrigenda.length === 0 ? 0 : applyPortalCorrigenda(deps.opportunities, opportunityId, corrigenda, context, options);
}

/**
 * One reading of a tender's page: its details (a changed closing date is
 * logged), the corrigenda it lists, and, when an extension moved the
 * closing date into the future, the tender open again.
 */
export function syncTenderSighting(
  deps: Pick<OpportunitySyncDeps, 'opportunities'>,
  tender: Parameters<OpportunityRepository['recordSighting']>[0],
  portalId: string,
  context: { jobId?: string | null } = {}
) {
  const opportunity = deps.opportunities.recordSighting(tender, portalId, context);
  recordPageCorrigenda(deps, opportunity.id, tender.detail_text ?? null, context);
  return deps.opportunities.reopenIfExtended(opportunity.id, new Date(), context);
}

/** Links possible retenders across every tender already recorded, for example at app start. */
export function linkAllPossibleRetenders(deps: Pick<OpportunitySyncDeps, 'opportunities'>): void {
  const byPortal = new Map<string, string[]>();
  for (const row of deps.opportunities.list()) byPortal.set(row.portal_id, [...(byPortal.get(row.portal_id) ?? []), row.id]);
  for (const [portalId, ids] of byPortal) linkPossibleRetenders(deps, portalId, ids);
}

/**
 * Links each tender this run saw to other tenders on the portal that look
 * like the same work under a new Tender ID, newer pointing at older. Only a
 * suggestion: the two records stay separate.
 */
export function linkPossibleRetenders(deps: Pick<OpportunitySyncDeps, 'opportunities'>, portalId: string, opportunityIds: Iterable<string>): void {
  const all = deps.opportunities.list({ portalId });
  const byId = new Map(all.map((row) => [row.id, row]));
  for (const id of opportunityIds) {
    const current = byId.get(id);
    if (!current) continue;
    for (const other of all) {
      if (other.id === current.id || !retenderReason(current, other)) continue;
      const currentIsNewer = current.first_seen_at > other.first_seen_at
        || (current.first_seen_at === other.first_seen_at && current.identity_key > other.identity_key);
      if (currentIsNewer) deps.opportunities.linkPossibleRetender(current.id, other.id);
      else deps.opportunities.linkPossibleRetender(other.id, current.id);
    }
  }
}

/**
 * Applies an operator decision made on a run-level tender row to its
 * durable record. A decision the record has already moved past (for
 * example approving a tender whose documents are collected) is ignored.
 */
export function applyTenderDecision(
  deps: Pick<OpportunitySyncDeps, 'opportunities'>,
  tenderOpportunityId: string | null | undefined,
  decision: OperatorDecision,
  context: { jobId?: string | null; note?: string | null } = {}
): void {
  if (!tenderOpportunityId) return;
  const opportunity = deps.opportunities.getById(tenderOpportunityId);
  if (!opportunity) return;
  const target = DECISION_TARGETS[decision];
  if (opportunity.lifecycle !== target && !canTransition(opportunity.lifecycle, target)) return;
  deps.opportunities.decide([opportunity.id], decision, context);
}

/** Ticking tenders for download is the operator's approval of them. */
export function recordDownloadSelection(deps: OpportunitySyncDeps, jobId: string, selectedTenderIds: string[]): void {
  const selected = new Set(selectedTenderIds);
  for (const tender of deps.tenders.listForJob(jobId)) {
    if (selected.has(tender.id)) applyTenderDecision(deps, tender.opportunity_id, 'APPROVE', { jobId });
  }
}

/** Marks approved tenders whose documents this run downloaded. */
export function recordCollectedDocuments(
  deps: OpportunitySyncDeps & { workflow: TenderWorkflowRepository },
  jobId: string
): void {
  for (const tender of deps.tenders.listForJob(jobId)) {
    if (!tender.opportunity_id) continue;
    const downloaded = deps.workflow.listDocuments(tender.id).filter((document) => document.state === 'DOWNLOADED').length;
    if (downloaded === 0) continue;
    const opportunity = deps.opportunities.getById(tender.opportunity_id);
    if (opportunity?.lifecycle !== 'APPROVED') continue;
    deps.opportunities.markDocumentsCollected(opportunity.id, { jobId }, { documents: downloaded });
  }
}
