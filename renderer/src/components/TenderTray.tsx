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

const MARK: Record<string, string> = { KEEP: 'Kept', UNCERTAIN: 'Look', REJECT: 'Rejected' };

/** The tray of files: one line per tender, grouped, the open one marked. */
export function TenderTray({ label, groups, selectedId, onSelect, emptyText }: TenderTrayProps) {
  const visible = groups.filter((group) => group.items.length > 0);
  return (
    <nav className="tray" aria-label={label}>
      {visible.length === 0 && <p className="tray__empty">{emptyText}</p>}
      {visible.map((group) => (
        <section key={group.id} className="tray__group" aria-label={group.title}>
          <h3 className="tray__heading">
            {group.title} <span className="count">{group.items.length}</span>
          </h3>
          {group.hint && <p className="tray__hint">{group.hint}</p>}
          <ul className="tray__list">
            {group.items.map((item) => {
              const closing = closingLabel(item.closingAt, item.closingDate);
              const selected = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={selected ? 'tray-item is-open' : 'tray-item'}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect(item.id)}
                  >
                    <span className="tray-item__title">{item.title}</span>
                    <span className="tray-item__meta">
                      <span className={`closing closing--${closing.urgency}`} title={closing.title}>{closing.text}</span>
                      {item.lifecycle !== 'NEW' && item.lifecycle !== 'SCREENED' ? (
                        <span className="mark mark--plain">{LIFECYCLE_LABELS[item.lifecycle] ?? item.lifecycle}</span>
                      ) : item.recommendation && (
                        <span className={`mark mark--${item.recommendation.toLowerCase()}`}>{MARK[item.recommendation]}</span>
                      )}
                    </span>
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
