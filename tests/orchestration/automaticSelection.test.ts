import { describe, expect, it } from 'vitest';
import { automaticDownloadSelection, type SelectableTender } from '../../src/orchestration/automaticSelection.js';

const tender = (
  id: string,
  effectiveClassification: SelectableTender['effectiveClassification'],
  opportunityLifecycle: SelectableTender['opportunityLifecycle'] = null
): SelectableTender => ({ id, effectiveClassification, opportunityLifecycle });

describe('automatic download selection', () => {
  it('collects shortlisted and needs-review tenders without asking', () => {
    const selected = automaticDownloadSelection([
      tender('keep', 'KEEP'),
      tender('review', 'UNCERTAIN', 'SCREENED'),
      tender('rejected', 'REJECT'),
      tender('not-run', 'NOT_RUN'),
    ]);
    expect(selected).toEqual(['keep', 'review']);
  });

  it('respects earlier Inbox decisions', () => {
    const selected = automaticDownloadSelection([
      tender('approved-in-inbox', 'UNCERTAIN', 'APPROVED'),
      tender('deferred', 'KEEP', 'DEFERRED'),
      tender('rejected-in-inbox', 'KEEP', 'REJECTED'),
      tender('already-collected', 'KEEP', 'DOCUMENTS_COLLECTED'),
      tender('expired', 'KEEP', 'EXPIRED'),
    ]);
    expect(selected).toEqual(['approved-in-inbox', 'deferred']);
  });
});
