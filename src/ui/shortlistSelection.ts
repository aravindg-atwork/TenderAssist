// Which tenders the operator may choose for document collection, and which
// start ticked. Inbox decisions win over the automatic screening result.

interface SelectableTender {
  id: string;
  effectiveClassification: 'KEEP' | 'REJECT' | 'UNCERTAIN' | 'NOT_RUN';
  opportunityLifecycle: string | null;
}

export function selectionCandidates<T extends SelectableTender>(tenders: T[]): T[] {
  return tenders.filter((tender) => tender.effectiveClassification === 'KEEP' || tender.effectiveClassification === 'UNCERTAIN');
}

export function defaultSelection(tenders: SelectableTender[]): Set<string> {
  return new Set(selectionCandidates(tenders).filter((tender) => {
    if (tender.opportunityLifecycle === 'APPROVED') return true;
    if (tender.opportunityLifecycle === 'REJECTED' || tender.opportunityLifecycle === 'DOCUMENTS_COLLECTED') return false;
    return tender.effectiveClassification === 'KEEP';
  }).map((tender) => tender.id));
}
