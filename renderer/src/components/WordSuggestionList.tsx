import type { WordSuggestion } from '../../../src/electron/ipcTypes';

export interface WordSuggestionListProps {
  title: string;
  suggestions: WordSuggestion[];
  /** Words already in the list, so an added suggestion disappears at once. */
  current: string[];
  onAdd: (phrase: string) => void;
}

/** Words learnt from the operator's decisions; each is added only when they choose to. */
export function WordSuggestionList({ title, suggestions, current, onAdd }: WordSuggestionListProps) {
  const taken = new Set(current.map((word) => word.toLocaleLowerCase()));
  const shown = suggestions.filter((item) => !taken.has(item.phrase.toLocaleLowerCase()));
  if (shown.length === 0) return null;
  return (
    <div className="suggest">
      <p className="suggest__title">{title}</p>
      <ul className="suggest__list">
        {shown.map((item) => (
          <li key={item.phrase} className="suggest__item">
            <span className="suggest__phrase">{item.phrase}</span>
            <span className="suggest__reason">{item.reason}</span>
            <button type="button" className="btn btn--quiet btn--small" onClick={() => onAdd(item.phrase)} aria-label={`Add ${item.phrase}`}>Add</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
