import type { TenderRepository } from '../persistence/repositories/tenderRepository.js';
import type { ClassificationRepository } from '../persistence/repositories/classificationRepository.js';
import type { TenderWorkflowRepository } from '../persistence/repositories/tenderWorkflowRepository.js';
import type { OpportunityRepository } from '../persistence/repositories/opportunityRepository.js';
import { canTransition, DECISION_TARGETS, type OperatorDecision } from '../state/opportunityLifecycle.js';

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
  for (const tender of deps.tenders.listForJob(jobId)) {
    const opportunity = deps.opportunities.recordSighting(tender, portalId, { jobId });
    if (!options.screening) continue;
    const gates = deps.classifications.listForTender(tender.id);
    const final = deps.classifications.getFinalForTender(tender.id);
    if (final === 'NOT_RUN') continue;
    deps.opportunities.recordScreening(opportunity.id, final, { jobId }, {
      gates: gates.map((gate) => ({ gate: gate.gate, result: gate.result, reasonCode: gate.reason_code, evidence: JSON.parse(gate.evidence_json) as unknown })),
    });
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
