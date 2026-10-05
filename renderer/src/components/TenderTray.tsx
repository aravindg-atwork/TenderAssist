import type { ReactNode } from 'react';
import type { TenderSummary } from '../../../src/electron/ipcTypes';
import { closingLabel, LIFECYCLE_LABELS } from '../format';

export interface TrayGroup {
  id: string;
  title: string;
  hint?: string;
  items: TenderSummary[];
  /** An action for the whole group, such as clearing reviewed rejects. */
  footer?: ReactNode;
}

export interface TenderTrayProps {
  label: string;
  groups: TrayGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyText: string;
}

const RECOMMENDATION_STATE: Record<string, { tone: string; words: string }> = {
  KEEP: { tone: 'keep', words: 'Kept by TenderAssist' },
  UNCERTAIN: { tone: 'look', words: 'Needs a look' },
  REJECT: { tone: 'reject', words: 'Rejected by TenderAssist' },
};
const LIFECYCLE_TONE: Record<string, string> = {
  APPROVED: 'keep', DOCUMENTS_COLLECTED: 'keep', ELIGIBILITY_REVIEWED: 'keep', PREPARING: 'keep', DEFERRED: 'later', REJECTED: 'reject',
};

function stateOf(item: TenderSummary): { tone: string; words: string } {
  if (item.lifecycle !== 'NEW' && item.lifecycle !== 'SCREENED') {
    return { tone: LIFECYCLE_TONE[item.lifecycle] ?? 'plain', words: LIFECYCLE_LABELS[item.lifecycle] ?? item.lifecycle };
  }
  return item.recommendation ? RECOMMENDATION_STATE[item.recommendation] : { tone: 'plain', words: 'Not screened' };
}

/** The tray of files: one ruled line per tender, its state as a coloured tag tab, the open one pulled out. */
export function TenderTray({ label, groups, selectedId, onSelect, emptyText }: TenderTrayProps) {
  const visible = groups.filter((group) => group.items.length > 0);
  return (
    <nav className="tray" aria-label={label}>
      {visible.length === 0 && <p className="tray__empty">{emptyText}</p>}
      {visible.map((group) => (
        <section key={group.id} className="tray__group" aria-label={group.title}>
          <h3 className="tray__heading">{group.title} <span className="count">{group.items.length}</span></h3>
          {group.hint && <p className="tray__hint">{group.hint}</p>}
          <ul className="tray__list">
            {group.items.map((item) => {
              const closing = closingLabel(item.closingAt, item.closingDate);
              const state = stateOf(item);
              const selected = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button type="button" className={selected ? 'edge is-open' : 'edge'} aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect(item.id)} title={item.title}>
                    <span className={`edge__tag edge__tag--${state.tone}`} aria-hidden="true" />
                    <span className="edge__title">{item.title}</span>
                    <span className={`edge__closing closing closing--${closing.urgency}`}>{closing.urgency === 'unknown' ? '' : closing.text}</span>
                    <span className="visually-hidden">{state.words}. {closing.text}.</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {group.footer && <div className="tray__footer">{group.footer}</div>}
        </section>
      ))}
    </nav>
  );
}
