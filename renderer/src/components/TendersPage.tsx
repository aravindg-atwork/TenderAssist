import { useCallback, useEffect, useState } from 'react';
import type { OperatorDecision, TenderSummary, TendersView } from '../../../src/electron/ipcTypes';
import { TenderFile, type FileAction } from './TenderFile';
import { TenderTray } from './TenderTray';

type Shelf = keyof TendersView;

const SHELVES: Array<{ id: Shelf; label: string; empty: string }> = [
  { id: 'approved', label: 'Approved', empty: 'Tenders you approve appear here while you work on them.' },
  { id: 'deferred', label: 'Later', empty: 'Nothing set aside. Choose Later on a tender when you need more time.' },
  { id: 'rejected', label: 'Rejected', empty: 'Nothing rejected yet.' },
  { id: 'earlier', label: 'Earlier, undecided', empty: 'No older undecided tenders.' },
  { id: 'closed', label: 'Closed', empty: 'Tenders move here when their closing date passes or they are cancelled.' },
];

// What makes sense from each shelf; the backend enforces the real rules.
const SHELF_ACTIONS: Record<Shelf, Array<{ decision: OperatorDecision; label: string; kind: FileAction['kind'] }>> = {
  approved: [{ decision: 'REOPEN', label: 'Move back to review', kind: 'plain' }],
  deferred: [{ decision: 'APPROVE', label: 'Approve', kind: 'approve' }, { decision: 'REOPEN', label: 'Move back to review', kind: 'plain' }],
  rejected: [{ decision: 'REOPEN', label: 'Move back to review', kind: 'plain' }],
  earlier: [{ decision: 'REOPEN', label: 'Move back to review', kind: 'plain' }],
  closed: [],
};

/** Every tender file, shelved by where it stands. */
export function TendersPage({ onInboxCount }: { onInboxCount?: (count: number) => void }) {
  const [view, setView] = useState<TendersView | null>(null);
  const [shelf, setShelf] = useState<Shelf>('approved');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    window.tenderAssist.getTenders().then(setView).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const items: TenderSummary[] = view ? view[shelf] : [];
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const current = SHELVES.find((entry) => entry.id === shelf)!;

  const decide = async (item: TenderSummary, decision: OperatorDecision, note?: string) => {
    setBusy(true);
    setError(null);
    try {
      const inbox = await window.tenderAssist.decideTenders([item.id], decision, note);
      onInboxCount?.(inbox.attentionCount);
      setDone(decision === 'REOPEN' ? 'Moved back to Today for review.' : 'Approved. Its folder is copied to Drive.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--desk">
      <header className="page__head">
        <h1>Tenders</h1>
        <p>Every tender you have seen, by where it stands. Tenders waiting for a decision are on Today.</p>
      </header>
      <div className="shelves" role="tablist" aria-label="Tender groups">
        {SHELVES.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={shelf === entry.id} className="shelf"
            onClick={() => { setShelf(entry.id); setSelectedId(null); setDone(null); }}>
            {entry.label} <span className="count">{view ? view[entry.id].length : ''}</span>
          </button>
        ))}
      </div>
      {error && <p className="notice notice--stop" role="alert">{error}</p>}
      <div className="desk">
        <TenderTray label={current.label} groups={[{ id: shelf, title: current.label, items }]}
          selectedId={selected?.id ?? null} onSelect={setSelectedId} emptyText={view ? current.empty : 'Loading…'} />
        <div className="desk__open">
          {done && <p className="decided" role="status">{done}</p>}
          {selected ? (
            <TenderFile
              key={selected.id}
              tender={selected}
              busy={busy}
              actions={SHELF_ACTIONS[shelf].map((action) => ({
                id: action.decision, label: action.label, kind: action.kind, run: (note) => void decide(selected, action.decision, note),
              }))}
              onDismissRelated={async (otherId) => { await window.tenderAssist.dismissRelatedTender(selected.id, otherId); load(); }}
            />
          ) : view && <div className="desk__empty"><p>{current.empty}</p></div>}
        </div>
      </div>
    </div>
  );
}
