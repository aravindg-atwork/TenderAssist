import { useCallback, useEffect, useState } from 'react';
import type { InboxItem, InboxView, OperatorDecision } from '../../../src/electron/ipcTypes';
import { getPortalDefinition } from '../../../src/config/portalRegistry';
import { closingLabel } from '../format';

export interface InboxProps {
  onStartDiscovery: () => void;
  onCountChange?: (count: number) => void;
}

const DECISION_LABELS: Record<OperatorDecision, string> = {
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  DEFER: 'Deferred',
  REOPEN: 'Moved to review',
};

function valueText(value: string | null): string | null {
  return value ? `₹${value}` : null;
}

function InboxRowCard({
  item,
  busy,
  onDecide,
}: {
  item: InboxItem;
  busy: boolean;
  onDecide: (ids: string[], decision: OperatorDecision, note?: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const closing = closingLabel(item.closingAt, item.closingDate);
  const meta = [item.department, item.organisation, valueText(item.value), getPortalDefinition(item.portalId).name]
    .filter((part): part is string => Boolean(part));
  const decide = (decision: OperatorDecision) => onDecide([item.id], decision, note.trim() || undefined);

  return (
    <article className="inbox-row" aria-busy={busy}>
      <div className="inbox-row__topline">
        <span className="inbox-row__id">{item.tenderId}</span>
        <span className={`closing-chip closing-chip--${closing.urgency}`} title={closing.title}>{closing.text}</span>
      </div>
      <h3 className="inbox-row__title">{item.title}</h3>
      {meta.length > 0 && <p className="inbox-row__meta">{meta.join(' · ')}</p>}
      <p className={`inbox-row__why inbox-row__why--${(item.recommendation ?? 'none').toLowerCase()}`}>{item.explanation}</p>
      {noteOpen && (
        <label className="inbox-row__note">
          <span>Decision note (optional)</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={1000} autoFocus />
        </label>
      )}
      <div className="inbox-row__actions">
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => decide('APPROVE')}>Approve</button>
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => decide('REJECT')}>Reject</button>
        {item.group !== 'CHANGED' && (
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => decide('DEFER')}>Defer</button>
        )}
        {!noteOpen && <button className="btn-link" type="button" onClick={() => setNoteOpen(true)}>Add note</button>}
      </div>
    </article>
  );
}

function InboxSection({ title, hint, items, busyIds, onDecide }: {
  title: string;
  hint: string;
  items: InboxItem[];
  busyIds: Set<string>;
  onDecide: (ids: string[], decision: OperatorDecision, note?: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="inbox-section" aria-label={title}>
      <header className="inbox-section__header">
        <h2>{title} <span className="inbox-section__count">{items.length}</span></h2>
        <p>{hint}</p>
      </header>
      <div className="inbox-section__list">
        {items.map((item) => <InboxRowCard key={item.id} item={item} busy={busyIds.has(item.id)} onDecide={onDecide} />)}
      </div>
    </section>
  );
}

export function Inbox({ onStartDiscovery, onCountChange }: InboxProps) {
  const [view, setView] = useState<InboxView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [lastAction, setLastAction] = useState<string | null>(null);

  const apply = useCallback((next: InboxView) => {
    setView(next);
    onCountChange?.(next.attentionCount);
  }, [onCountChange]);

  const load = useCallback(() => {
    window.tenderAssist.getInbox().then(apply).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [apply]);

  useEffect(() => { load(); }, [load]);
  // A finished phase can add tenders; refresh when any run reports an outcome.
  useEffect(() => window.tenderAssist.onJobUpdate((update) => { if (update.outcome) load(); }), [load]);

  const decide = async (ids: string[], decision: OperatorDecision, note?: string) => {
    setBusyIds((current) => new Set([...current, ...ids]));
    setError(null);
    try {
      apply(await window.tenderAssist.decideTenders(ids, decision, note));
      setLastAction(`${DECISION_LABELS[decision]}: ${ids.length === 1 ? '1 tender' : `${ids.length} tenders`}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyIds((current) => new Set([...current].filter((id) => !ids.includes(id))));
    }
  };

  const acknowledge = async () => {
    if (!view) return;
    const runIds = [...new Set(view.autoRejected.map((item) => item.screeningJobId).filter((id): id is string => Boolean(id)))];
    setError(null);
    try {
      apply(await window.tenderAssist.acknowledgeRuns(runIds));
      setLastAction('Automatic rejects cleared from the Inbox. They remain in your tender history.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!view) {
    return <div className="inbox"><p className="empty-state">{error ?? 'Loading your Inbox…'}</p></div>;
  }

  const nothingToReview = view.attentionCount === 0;

  return (
    <div className="inbox">
      <div className="list-header">
        <div className="page-heading">
          <h1>Inbox</h1>
          <p>{nothingToReview ? 'Nothing needs a decision right now.' : `${view.attentionCount} ${view.attentionCount === 1 ? 'tender needs' : 'tenders need'} your decision. Nearest closing date first.`}</p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={onStartDiscovery}>Start discovery</button>
      </div>

      <div aria-live="polite" className="inbox__status">
        {error && <p className="error-text" role="alert">{error}</p>}
        {!error && lastAction && <p className="inbox__confirmation">{lastAction}</p>}
      </div>

      {nothingToReview && (
        <div className="empty-panel inbox__empty">
          <h2>You are up to date</h2>
          <p>New tenders appear here after a discovery run. Start one for today&rsquo;s publication date.</p>
          <button className="btn btn-primary" type="button" onClick={onStartDiscovery}>Start a discovery run</button>
        </div>
      )}

      <InboxSection title="Needs your review" hint="Automation could not decide, or you moved these back for review."
        items={view.uncertain} busyIds={busyIds} onDecide={decide} />
      <InboxSection title="Recommended" hint="Passed every check. Approve to collect documents in the next run."
        items={view.recommended} busyIds={busyIds} onDecide={decide} />
      <InboxSection title="Changed since your decision" hint="Dates, value, or a corrigendum changed after you decided. Confirm or change your call."
        items={view.changed} busyIds={busyIds} onDecide={decide} />

      {view.autoRejected.length > 0 && (
        <details className="inbox-rejects">
          <summary>Automatically rejected <span className="inbox-section__count">{view.autoRejected.length}</span></summary>
          <p className="inbox-rejects__hint">Check that the rules are catching the right tenders. Move any mistake back to review.</p>
          <ul className="inbox-rejects__list">
            {view.autoRejected.map((item) => (
              <li key={item.id} className="inbox-reject">
                <div className="inbox-reject__text">
                  <span className="inbox-reject__title">{item.title}</span>
                  <span className="inbox-reject__why">{item.explanation}</span>
                </div>
                <button className="btn btn-secondary" type="button" disabled={busyIds.has(item.id)} onClick={() => decide([item.id], 'REOPEN')}>
                  Move to review
                </button>
              </li>
            ))}
          </ul>
          <div className="inbox-rejects__footer">
            <button className="btn btn-secondary" type="button" onClick={acknowledge}>Done with these rejects</button>
          </div>
        </details>
      )}
    </div>
  );
}
