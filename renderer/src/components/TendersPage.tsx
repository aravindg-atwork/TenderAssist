import { useCallback, useEffect, useState } from 'react';
import type { OperatorDecision, TenderSummary, TendersView, TimelineEntry } from '../../../src/electron/ipcTypes';
import { getPortalDefinition } from '../../../src/config/portalRegistry';
import { absoluteDateTime, closingLabel, LIFECYCLE_LABELS, relativeTime } from '../format';
import { RelatedTenders } from './RelatedTenders';

type Tab = keyof TendersView;

const TABS: Array<{ id: Tab; label: string; empty: string }> = [
  { id: 'approved', label: 'Approved', empty: 'Tenders you approve in the Inbox appear here while you work on them.' },
  { id: 'deferred', label: 'Deferred', empty: 'Nothing deferred. Use Defer in the Inbox when you need more time to decide.' },
  { id: 'rejected', label: 'Rejected', empty: 'Nothing rejected yet.' },
  { id: 'earlier', label: 'Earlier, undecided', empty: 'No undecided tenders outside the Inbox.' },
  { id: 'closed', label: 'Closed', empty: 'Tenders move here when their closing date passes or they are cancelled.' },
];

// Which operator actions make sense from each tab; the backend enforces the real rules.
const TAB_ACTIONS: Record<Tab, Array<{ decision: OperatorDecision; label: string }>> = {
  approved: [{ decision: 'REOPEN', label: 'Move to review' }],
  deferred: [{ decision: 'APPROVE', label: 'Approve' }, { decision: 'REOPEN', label: 'Move to review' }],
  rejected: [{ decision: 'REOPEN', label: 'Move to review' }],
  earlier: [{ decision: 'REOPEN', label: 'Move to review' }],
  closed: [],
};

function Timeline({ opportunityId }: { opportunityId: string }) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    window.tenderAssist.getTenderTimeline(opportunityId).then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [opportunityId]);
  if (error) return <p className="error-text">{error}</p>;
  if (!entries) return <p className="tender-history__loading">Loading history…</p>;
  return (
    <ol className="tender-history">
      {entries.map((entry) => (
        <li key={entry.id} className={`tender-history__entry tender-history__entry--${entry.actor}`}>
          <div className="tender-history__line">
            <span className="tender-history__title">{entry.title}</span>
            <time dateTime={entry.at} title={absoluteDateTime(entry.at)}>{relativeTime(entry.at)}</time>
          </div>
          {entry.detail && <p className="tender-history__detail">{entry.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

function TenderListRow({ item, tab, busy, onDecide, onDismissRelated }: {
  item: TenderSummary;
  tab: Tab;
  busy: boolean;
  onDecide: (id: string, decision: OperatorDecision) => void;
  onDismissRelated: (id: string, otherId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const closing = closingLabel(item.closingAt, item.closingDate);
  const meta = [item.department, item.organisation, item.value ? `₹${item.value}` : null, getPortalDefinition(item.portalId).name]
    .filter((part): part is string => Boolean(part));
  return (
    <article className="tender-row" aria-busy={busy}>
      <div className="inbox-row__topline">
        <span className="inbox-row__id">{item.tenderId}</span>
        <span className="tender-row__badges">
          {item.changedSinceDecision && <span className="pill pill-pending">Changed</span>}
          <span className="pill pill-neutral">{LIFECYCLE_LABELS[item.lifecycle] ?? item.lifecycle}</span>
          <span className={`closing-chip closing-chip--${closing.urgency}`} title={closing.title}>{closing.text}</span>
        </span>
      </div>
      <h3 className="inbox-row__title">{item.title}</h3>
      {meta.length > 0 && <p className="inbox-row__meta">{meta.join(' · ')}</p>}
      <RelatedTenders related={item.related} onDismiss={(otherId) => onDismissRelated(item.id, otherId)} />
      <div className="inbox-row__actions">
        {TAB_ACTIONS[tab].map((action) => (
          <button key={action.decision} className="btn btn-secondary" type="button" disabled={busy} onClick={() => onDecide(item.id, action.decision)}>
            {action.label}
          </button>
        ))}
        <button className="btn-link" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide history' : 'Show history'}
        </button>
      </div>
      {open && <Timeline opportunityId={item.id} />}
    </article>
  );
}

export function TendersPage({ onInboxChange }: { onInboxChange?: (count: number) => void }) {
  const [view, setView] = useState<TendersView | null>(null);
  const [tab, setTab] = useState<Tab>('approved');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const load = useCallback(() => {
    window.tenderAssist.getTenders().then(setView).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, decision: OperatorDecision) => {
    setBusyId(id); setError(null);
    try {
      const inbox = await window.tenderAssist.decideTenders([id], decision);
      onInboxChange?.(inbox.attentionCount);
      setLastAction(decision === 'REOPEN' ? 'Moved to the Inbox for review.' : 'Approved.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const dismissRelated = async (id: string, otherId: string) => {
    setError(null);
    try {
      await window.tenderAssist.dismissRelatedTender(id, otherId);
      setLastAction('Marked as not related. It will not be suggested again.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!view) return <div className="inbox"><p className="empty-state">{error ?? 'Loading tenders…'}</p></div>;
  const current = TABS.find((entry) => entry.id === tab)!;
  const items = view[tab];

  return (
    <div className="inbox">
      <div className="list-header">
        <div className="page-heading">
          <h1>Tenders</h1>
          <p>Every tender you have seen, grouped by where it stands. Tenders waiting for a decision stay in the Inbox.</p>
        </div>
      </div>
      <div className="segmented" role="tablist" aria-label="Tender groups">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'segmented__item is-active' : 'segmented__item'}
            onClick={() => setTab(entry.id)}
          >
            {entry.label} <span className="inbox-section__count">{view[entry.id].length}</span>
          </button>
        ))}
      </div>
      <div aria-live="polite" className="inbox__status">
        {error && <p className="error-text" role="alert">{error}</p>}
        {!error && lastAction && <p className="inbox__confirmation">{lastAction}</p>}
      </div>
      <div role="tabpanel" aria-label={current.label} className="inbox-section__list">
        {items.length === 0
          ? <p className="empty-panel tenders-empty">{current.empty}</p>
          : items.map((item) => <TenderListRow key={item.id} item={item} tab={tab} busy={busyId === item.id} onDecide={decide} onDismissRelated={dismissRelated} />)}
      </div>
    </div>
  );
}
