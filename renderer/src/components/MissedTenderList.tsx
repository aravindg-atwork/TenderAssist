import type { MissedFix, MissedSuggestion } from '../../../src/electron/ipcTypes';

export interface MissedTenderListProps {
  suggestions: MissedSuggestion[];
  /** Whether the fix is in Settings already, so an applied one disappears at once. */
  isApplied: (fix: MissedFix) => boolean;
  /** Makes the change, as the operator would by hand. */
  onApply: (fix: MissedFix) => void;
  /** "Keep it" for an excluded word: the suggestion stops showing. */
  onKeep: (key: string) => void;
  kept: readonly string[];
}

/** Why TenderAssist missed tenders the operator wanted, and the change that would have kept them. */
export function MissedTenderList({ suggestions, isApplied, onApply, onKeep, kept }: MissedTenderListProps) {
  const shown = suggestions.filter((item) => !isApplied(item.fix) && !kept.includes(item.key));
  if (shown.length === 0) return null;
  return (
    <div className="suggest" id="look-missed">
      <p className="suggest__title">Tenders you wanted that TenderAssist missed</p>
      <ul className="suggest__list">
        {shown.map((item) => (
          <li key={item.key} className="suggest__item suggest__item--wide" title={item.titles.join('\n')}>
            <span className="suggest__text">
              <span className="suggest__phrase">{item.label}</span>
              <span className="suggest__reason">{item.reason}</span>
              {item.note && <span className="suggest__note">{item.note}</span>}
            </span>
            {item.fix.kind === 'REVIEW_EXCLUDED_WORD' ? (
              <span className="suggest__actions">
                <button type="button" className="btn btn--quiet btn--small" onClick={() => onApply(item.fix)}>Remove it</button>
                <button type="button" className="btn btn--text btn--small" onClick={() => onKeep(item.key)}>Keep it</button>
              </span>
            ) : (
              <button type="button" className="btn btn--quiet btn--small" onClick={() => onApply(item.fix)} aria-label={item.label}>Add</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
