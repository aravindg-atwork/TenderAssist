// Which tenders a run downloads documents for, without stopping to ask.
// Shortlisted and needs-review tenders are both collected, so the operator
// can decide in the Inbox with the documents already on disk. Collecting is
// not approval: only an Inbox approval sends a tender to Drive.

import type { OpportunityLifecycle } from '../state/opportunityLifecycle.js';

export interface SelectableTender {
  id: string;
  effectiveClassification: 'KEEP' | 'REJECT' | 'UNCERTAIN' | 'NOT_RUN';
  opportunityLifecycle: OpportunityLifecycle | null;
}

// Tenders the operator already rejected, or has moved past document
// collection, are left alone.
const COLLECTABLE_LIFECYCLES: readonly OpportunityLifecycle[] = ['NEW', 'SCREENED', 'DEFERRED', 'APPROVED'];

export function automaticDownloadSelection(tenders: SelectableTender[]): string[] {
  return tenders
    .filter((tender) => tender.effectiveClassification === 'KEEP' || tender.effectiveClassification === 'UNCERTAIN')
    .filter((tender) => tender.opportunityLifecycle === null || COLLECTABLE_LIFECYCLES.includes(tender.opportunityLifecycle))
    .map((tender) => tender.id);
}
