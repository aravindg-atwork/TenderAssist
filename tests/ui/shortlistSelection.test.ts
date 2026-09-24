import { describe, expect, it } from 'vitest';
import { defaultSelection, selectionCandidates } from '../../src/ui/shortlistSelection.js';

type T = Parameters<typeof defaultSelection>[0][number];
const tender = (id: string, effectiveClassification: T['effectiveClassification'], opportunityLifecycle: T['opportunityLifecycle'] = null): T =>
  ({ id, effectiveClassification, opportunityLifecycle });

describe('shortlist selection', () => {
  const tenders = [
    tender('keep', 'KEEP'),
    tender('review', 'UNCERTAIN'),
    tender('rejected', 'REJECT'),
    tender('approved-in-inbox', 'UNCERTAIN', 'APPROVED'),
    tender('rejected-in-inbox', 'KEEP', 'REJECTED'),
    tender('already-collected', 'KEEP', 'DOCUMENTS_COLLECTED'),
  ];

  it('offers shortlisted and needs-review tenders, not rejected ones', () => {
    expect(selectionCandidates(tenders).map((t) => t.id)).toEqual(['keep', 'review', 'approved-in-inbox', 'rejected-in-inbox', 'already-collected']);
  });

  it('ticks automatic keeps and Inbox approvals; Inbox rejections and collected tenders start unticked', () => {
    expect([...defaultSelection(tenders)].sort()).toEqual(['approved-in-inbox', 'keep']);
  });
});
