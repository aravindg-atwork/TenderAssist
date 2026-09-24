import type { DatabaseSync } from 'node:sqlite';
import { ClassificationRepository } from './repositories/classificationRepository.js';
import { OpportunityRepository } from './repositories/opportunityRepository.js';
import type { TenderRow } from './repositories/tenderRepository.js';
import { IllegalOpportunityTransitionError } from '../state/opportunityLifecycle.js';

interface BackfillRow extends TenderRow {
  portal_id: string | null;
  review_decision: 'KEEP' | 'REJECT' | null;
  review_reason: string | null;
  review_decided_at: string | null;
  downloaded_count: number;
}

/**
 * One-time conversion of per-job tender rows into opportunities (migration
 * 010). Replays history in the order it happened so the latest sighting and
 * decision win, and the event log carries the original timestamps.
 */
export function backfillOpportunities(db: DatabaseSync, now = new Date()): void {
  const opportunities = new OpportunityRepository(db);
  const classifications = new ClassificationRepository(db);
  const rows = db.prepare(
    `SELECT t.*, c.portal_id AS portal_id,
            r.decision AS review_decision, r.reason AS review_reason, r.decided_at AS review_decided_at,
            (SELECT COUNT(*) FROM tender_documents d WHERE d.tender_id = t.id AND d.state = 'DOWNLOADED') AS downloaded_count
     FROM tenders t
     LEFT JOIN job_run_configs c ON c.job_id = t.job_id
     LEFT JOIN tender_reviews r ON r.tender_id = t.id
     WHERE t.opportunity_id IS NULL
     ORDER BY t.created_at ASC, t.rowid ASC`
  ).all() as unknown as BackfillRow[];

  for (const row of rows) {
    if (!OpportunityRepository.identityKey(row.tender_portal_id, row.tender_ref)) continue;
    const context = { jobId: row.job_id, at: row.created_at };
    const opportunity = opportunities.recordSighting(row, row.portal_id ?? 'tamil-nadu', context);
    const final = classifications.getFinalForTender(row.id);
    if (final !== 'NOT_RUN') {
      opportunities.recordScreening(opportunity.id, final, { ...context, at: row.detail_reviewed_at ?? row.updated_at });
    }
    // Before this migration, ticking a tender for download was the approval.
    const approvedByDownload = row.downloaded_count > 0 && row.review_decision !== 'REJECT';
    const decision = row.review_decision === 'REJECT' ? 'REJECT' : row.review_decision === 'KEEP' || approvedByDownload ? 'APPROVE' : null;
    try {
      if (decision) {
        opportunities.decide([opportunity.id], decision, {
          jobId: row.job_id,
          at: row.review_decided_at ?? row.updated_at,
          note: row.review_reason,
        });
      }
      if (approvedByDownload) {
        opportunities.markDocumentsCollected(opportunity.id, { jobId: row.job_id, at: row.updated_at }, { documents: row.downloaded_count });
      }
    } catch (error) {
      // An older run's decision that no longer fits the replayed state
      // (e.g. approving a tender whose documents are already collected) is
      // skipped; the later state stands.
      if (!(error instanceof IllegalOpportunityTransitionError)) throw error;
    }
  }
  opportunities.expireOverdue(now);
}
