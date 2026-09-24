import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { InboxItem, InboxView, OperatorDecision } from '../../../src/electron/ipcTypes';
import { getPortalDefinition } from '../../../src/config/portalRegistry';
import { closingLabel, LIFECYCLE_LABELS } from '../format';
import { RelatedTenders } from './RelatedTenders';

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

const DECISION_BUTTONS: Record<OperatorDecision, string> = {
  APPROVE: 'Approve',
  REJECT: 'Reject',
  DEFER: 'Defer',
  REOPEN: 'Move to review',
};

const KEY_DECISIONS: Record<string, OperatorDecision> = { a: 'APPROVE', r: 'REJECT', d: 'DEFER' };

type Decide = (ids: string[], decision: OperatorDecision, note?: string) => void;

// A tender that changed after a decision can switch to the other call, or
// keep the one it has. Mirrors the backend lifecycle rules.
const CHANGED_ALTERNATIVES: Record<string, OperatorDecision[]> = {
  APPROVED: ['REJECT'],
  DOCUMENTS_COLLECTED: ['REJECT'],
  DEFERRED: ['APPROVE', 'REJECT'],
  REJECTED: ['APPROVE'],
};

/** Decisions offered for this row, in button order. */
function decisionsFor(item: InboxItem): OperatorDecision[] {
  if (item.group !== 'CHANGED') return ['APPROVE', 'REJECT', 'DEFER'];
  return CHANGED_ALTERNATIVES[item.lifecycle] ?? [];
}

function valueText(value: string | null): string | null {
  return value ? `₹${value}` : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function InboxRowCard({
  item, busy, focused, selectable, selected, noteOpen, note,
  onFocus, onToggleSelected, onOpenNote, onNoteChange, onDecide, onKeepDecision, onDismissRelated, rowRef,
}: {
  item: InboxItem;
  busy: boolean;
  focused: boolean;
  selectable: boolean;
  selected: boolean;
  noteOpen: boolean;
  note: string;
  onFocus: () => void;
  onToggleSelected: (checked: boolean) => void;
  onOpenNote: () => void;
  onNoteChange: (note: string) => void;
  onDecide: Decide;
  onKeepDecision: (id: string) => void;
  onDismissRelated: (id: string, otherId: string) => void;
  rowRef: (element: HTMLElement | null) => void;
}) {
  const closing = closingLabel(item.closingAt, item.closingDate);
  const meta = [item.department, item.organisation, valueText(item.value), getPortalDefinition(item.portalId).name]
    .filter((part): part is string => Boolean(part));
  const decide = (decision: OperatorDecision) => onDecide([item.id], decision, note.trim() || undefined);

  return (
    <article
      ref={rowRef}
      className={focused ? 'inbox-row is-focused' : 'inbox-row'}
      aria-busy={busy}
      tabIndex={0}
      onFocus={onFocus}
      aria-label={item.title}
    >
      <div className="inbox-row__topline">
        {selectable && (
          <label className="inbox-row__select">
            <input type="checkbox" checked={selected} onChange={(event) => onToggleSelected(event.target.checked)} />
            <span className="visually-hidden">Select for bulk approval</span>
          </label>
        )}
        <span className="inbox-row__id">{item.tenderId}</span>
        <span className={`closing-chip closing-chip--${closing.urgency}`} title={closing.title}>{closing.text}</span>
      </div>
      <h3 className="inbox-row__title">{item.title}</h3>
      {meta.length > 0 && <p className="inbox-row__meta">{meta.join(' · ')}</p>}
      <p className={`inbox-row__why inbox-row__why--${(item.recommendation ?? 'none').toLowerCase()}`}>{item.explanation}</p>
      <RelatedTenders related={item.related} onDismiss={(otherId) => onDismissRelated(item.id, otherId)} />
      {noteOpen && (
        <label className="inbox-row__note">
          <span>Decision note (optional)</span>
          <textarea value={note} onChange={(event) => onNoteChange(event.target.value)} rows={2} maxLength={1000} autoFocus />
        </label>
      )}
      <div className="inbox-row__actions">
        {item.group === 'CHANGED' && (
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => onKeepDecision(item.id)}>
            {item.lifecycle === 'CANCELLED' ? 'OK, noted' : `Keep: ${LIFECYCLE_LABELS[item.lifecycle] ?? item.lifecycle}`}
          </button>
        )}
        {decisionsFor(item).map((decision, index) => (
          <button
            key={decision}
            className={index === 0 && item.group !== 'CHANGED' ? 'btn btn-primary' : 'btn btn-secondary'}
            type="button"
            disabled={busy}
            onClick={() => decide(decision)}
          >
            {DECISION_BUTTONS[decision]}
          </button>
        ))}
        {!noteOpen && item.lifecycle !== 'CANCELLED' && <button className="btn-link" type="button" onClick={onOpenNote}>Add note</button>}
      </div>
    </article>
  );
}

export function Inbox({ onStartDiscovery, onCountChange }: InboxProps) {
  const [view, setView] = useState<InboxView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [noteOpenIds, setNoteOpenIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const rowRefs = useRef(new Map<string, HTMLElement>());

  // Keyboard order follows the page: review, recommended, changed.
  const ordered = useMemo(() => view ? [...view.uncertain, ...view.recommended, ...view.changed] : [], [view]);

  const apply = useCallback((next: InboxView) => {
    setView(next);
    onCountChange?.(next.attentionCount);
    const stillRecommended = new Set(next.recommended.map((item) => item.id));
    setSelectedIds((current) => new Set([...current].filter((id) => stillRecommended.has(id))));
  }, [onCountChange]);

  const load = useCallback(() => {
    window.tenderAssist.getInbox().then(apply).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [apply]);

  useEffect(() => { load(); }, [load]);
  // A finished phase can add tenders; refresh when any run reports an outcome.
  useEffect(() => window.tenderAssist.onJobUpdate((update) => { if (update.outcome) load(); }), [load]);

  const focusRow = useCallback((id: string | null) => {
    setFocusedId(id);
    if (!id) return;
    const element = rowRefs.current.get(id);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest' });
  }, []);

  const decide: Decide = useCallback(async (ids, decision, note) => {
    const focusIndex = focusedId ? ordered.findIndex((item) => item.id === focusedId) : -1;
    setBusyIds((current) => new Set([...current, ...ids]));
    setError(null);
    try {
      const next = await window.tenderAssist.decideTenders(ids, decision, note);
      apply(next);
      setLastAction(`${DECISION_LABELS[decision]}: ${ids.length === 1 ? '1 tender' : `${ids.length} tenders`}.`);
      setNotes((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id))));
      setNoteOpenIds((current) => new Set([...current].filter((id) => !ids.includes(id))));
      // Keep the reviewer's place: move focus to whatever now sits where the decided row was.
      if (focusIndex >= 0 && focusedId && ids.includes(focusedId)) {
        const nextOrdered = [...next.uncertain, ...next.recommended, ...next.changed];
        const target = nextOrdered[Math.min(focusIndex, nextOrdered.length - 1)];
        requestAnimationFrame(() => focusRow(target?.id ?? null));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyIds((current) => new Set([...current].filter((id) => !ids.includes(id))));
    }
  }, [apply, focusRow, focusedId, ordered]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target) || confirmingBulk) return;
      const key = event.key.toLowerCase();
      const index = focusedId ? ordered.findIndex((item) => item.id === focusedId) : -1;
      if (key === 'j' || key === 'k') {
        if (ordered.length === 0) return;
        event.preventDefault();
        const next = key === 'j' ? Math.min(index + 1, ordered.length - 1) : Math.max(index - 1, 0);
        focusRow(ordered[next].id);
        return;
      }
      const item = index >= 0 ? ordered[index] : null;
      if (!item || busyIds.has(item.id)) return;
      if (KEY_DECISIONS[key] && decisionsFor(item).includes(KEY_DECISIONS[key])) {
        event.preventDefault();
        void decide([item.id], KEY_DECISIONS[key], notes[item.id]?.trim() || undefined);
      } else if (key === 'n') {
        event.preventDefault();
        setNoteOpenIds((current) => new Set([...current, item.id]));
      } else if (key === 'x' && item.group === 'RECOMMENDED') {
        event.preventDefault();
        setSelectedIds((current) => {
          const next = new Set(current);
          if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
          return next;
        });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busyIds, confirmingBulk, decide, focusRow, focusedId, notes, ordered]);

  const keepDecision = useCallback(async (id: string) => {
    setBusyIds((current) => new Set([...current, id]));
    setError(null);
    try {
      apply(await window.tenderAssist.acknowledgeTenderChanges([id]));
      setLastAction('Decision kept. The change is recorded in the tender history.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyIds((current) => new Set([...current].filter((busyId) => busyId !== id)));
    }
  }, [apply]);

  const dismissRelated = useCallback(async (id: string, otherId: string) => {
    setError(null);
    try {
      await window.tenderAssist.dismissRelatedTender(id, otherId);
      setLastAction('Marked as not related. It will not be suggested again.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [load]);

  const acknowledge = async () => {
    if (!view) return;
    const runIds = [...new Set(view.autoRejected.map((item) => item.screeningJobId).filter((id): id is string => Boolean(id)))];
    setError(null);
    try {
      apply(await window.tenderAssist.acknowledgeRuns(runIds));
      setLastAction('Automatic rejects cleared from the Inbox. They remain under Tenders.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!view) {
    return <div className="inbox"><p className="empty-state">{error ?? 'Loading your Inbox…'}</p></div>;
  }

  const nothingToReview = view.attentionCount === 0;
  const selectedItems = view.recommended.filter((item) => selectedIds.has(item.id));
  const allRecommendedSelected = view.recommended.length > 0 && selectedItems.length === view.recommended.length;

  const renderRow = (item: InboxItem) => (
    <InboxRowCard
      key={item.id}
      item={item}
      busy={busyIds.has(item.id)}
      focused={focusedId === item.id}
      selectable={item.group === 'RECOMMENDED'}
      selected={selectedIds.has(item.id)}
      noteOpen={noteOpenIds.has(item.id)}
      note={notes[item.id] ?? ''}
      onFocus={() => setFocusedId(item.id)}
      onToggleSelected={(checked) => setSelectedIds((current) => {
        const next = new Set(current);
        if (checked) next.add(item.id); else next.delete(item.id);
        return next;
      })}
      onOpenNote={() => setNoteOpenIds((current) => new Set([...current, item.id]))}
      onNoteChange={(value) => setNotes((current) => ({ ...current, [item.id]: value }))}
      onDecide={decide}
      onKeepDecision={keepDecision}
      onDismissRelated={dismissRelated}
      rowRef={(element) => { if (element) rowRefs.current.set(item.id, element); else rowRefs.current.delete(item.id); }}
    />
  );

  const section = (title: string, hint: string, items: InboxItem[], toolbar?: ReactNode) => items.length > 0 && (
    <section className="inbox-section" aria-label={title}>
      <header className="inbox-section__header">
        <div>
          <h2>{title} <span className="inbox-section__count">{items.length}</span></h2>
          <p>{hint}</p>
        </div>
        {toolbar}
      </header>
      <div className="inbox-section__list">{items.map(renderRow)}</div>
    </section>
  );

  const bulkToolbar = (
    <div className="bulk-toolbar">
      <label className="bulk-toolbar__all">
        <input
          type="checkbox"
          checked={allRecommendedSelected}
          onChange={(event) => setSelectedIds(event.target.checked ? new Set(view.recommended.map((item) => item.id)) : new Set())}
        />
        <span>Select all</span>
      </label>
      <button className="btn btn-primary" type="button" disabled={selectedItems.length === 0} onClick={() => setConfirmingBulk(true)}>
        Approve {selectedItems.length || ''} selected
      </button>
    </div>
  );

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

      {!nothingToReview && (
        <p className="keyboard-hint">
          Keyboard: <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>A</kbd> approve · <kbd>R</kbd> reject · <kbd>D</kbd> defer · <kbd>N</kbd> note · <kbd>X</kbd> select
        </p>
      )}

      {confirmingBulk && selectedItems.length > 0 && (
        <div className="bulk-confirm" role="dialog" aria-modal="false" aria-labelledby="bulk-confirm-title">
          <h2 id="bulk-confirm-title">Approve {selectedItems.length} {selectedItems.length === 1 ? 'tender' : 'tenders'}?</h2>
          <p>They will be pre-ticked for download when their run asks which documents to collect.</p>
          <ul>{selectedItems.map((item) => <li key={item.id}>{item.title}</li>)}</ul>
          <div className="bulk-confirm__actions">
            <button className="btn btn-primary" type="button" autoFocus onClick={() => {
              setConfirmingBulk(false);
              void decide(selectedItems.map((item) => item.id), 'APPROVE');
            }}>
              Approve {selectedItems.length}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setConfirmingBulk(false)}>Cancel</button>
          </div>
        </div>
      )}

      {nothingToReview && (
        <div className="empty-panel inbox__empty">
          <h2>You are up to date</h2>
          <p>New tenders appear here after a discovery run. Start one for today&rsquo;s publication date.</p>
          <button className="btn btn-primary" type="button" onClick={onStartDiscovery}>Start a discovery run</button>
        </div>
      )}

      {section('Needs your review', 'Automation could not decide, or you moved these back for review.', view.uncertain)}
      {section('Recommended', 'Passed every check. Approved tenders are pre-ticked for download when their run asks which documents to collect.', view.recommended, bulkToolbar)}
      {section('Changed since your decision', 'Dates, value, or a corrigendum changed after you decided. Confirm or change your call.', view.changed)}

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
