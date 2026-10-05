// Which tenders a run collects, without stopping to ask: tenders kept from
// their full details page (medium or high confidence), and tenders the
// operator already approved. Uncertain ones are left for the Inbox. Collecting is not approval: only an Inbox approval
// sends a tender to Drive.

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
    .filter((tender) => tender.effectiveClassification === 'KEEP' || tender.opportunityLifecycle === 'APPROVED')
    .filter((tender) => tender.opportunityLifecycle === null || COLLECTABLE_LIFECYCLES.includes(tender.opportunityLifecycle))
    .map((tender) => tender.id);
}
