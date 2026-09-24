import type { TenderSummary } from '../../../src/electron/ipcTypes';
import { LIFECYCLE_LABELS } from '../format';

/** Possible retenders: shown as a hint, never merged. */
export function RelatedTenders({ related }: { related: TenderSummary['related'] }) {
  if (related.length === 0) return null;
  return (
    <ul className="related-tenders" aria-label="Possible retender or related tender">
      {related.map((other) => (
        <li key={other.id}>
          <span className="related-tenders__label">
            {other.direction === 'RETENDER_OF' ? 'Possible retender of' : 'Possibly retendered as'}
          </span>{' '}
          <span className="related-tenders__id">{other.tenderId}</span>{' '}
          <span className="related-tenders__status">({LIFECYCLE_LABELS[other.lifecycle] ?? other.lifecycle})</span>
          <span className="related-tenders__why"> — {other.reason}: “{other.title}”</span>
        </li>
      ))}
    </ul>
  );
}
