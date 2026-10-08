import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OperatorDecision, TenderSummary, TendersView } from '../../../src/electron/ipcTypes';
import { TenderFile, type FileAction } from './TenderFile';
import { TenderCard } from './TenderCard';
import { FilterPills, Pager, usePage } from './Pager';
import { BackIcon, SearchIcon } from './icons';
import { plainError } from '../words';

type Shelf = keyof TendersView;
type Sort = 'closing' | 'published' | 'value';

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

const amount = (value: string | null) => Number((value ?? '').replace(/[^\d.]/g, '')) || 0;
const time = (iso: string | null, fallback: number) => (iso ? Date.parse(iso.length <= 10 ? `${iso}T00:00:00` : iso) : NaN) || fallback;

const SORTS: Record<Sort, { label: string; compare: (a: TenderSummary, b: TenderSummary) => number }> = {
  closing: { label: 'Closing soonest', compare: (a, b) => time(a.closingAt, Infinity) - time(b.closingAt, Infinity) },
  published: { label: 'Newest published', compare: (a, b) => time(b.publishedDate, 0) - time(a.publishedDate, 0) },
  value: { label: 'Highest value', compare: (a, b) => amount(b.value) - amount(a.value) },
};

/** Every tender, shelved by where it stands, as cards you can search and sort. */
export function TendersPage({ onInboxCount }: { onInboxCount?: (count: number) => void }) {
  const [view, setView] = useState<TendersView | null>(null);
  const [shelf, setShelf] = useState<Shelf>('approved');
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('closing');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    window.tenderAssist.getTenders().then(setView).catch((err) => setError(plainError(err)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const items: TenderSummary[] = view ? view[shelf] : [];
  const needle = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => items
    .filter((item) => !needle || `${item.title} ${item.department ?? ''} ${item.organisation ?? ''} ${item.tenderId} ${item.reference}`.toLocaleLowerCase().includes(needle))
    .sort(SORTS[sort].compare), [items, needle, sort]);
  const { page, pages, shown, setPage } = usePage(filtered, `${shelf}|${needle}|${sort}`, 12);
  const current = SHELVES.find((entry) => entry.id === shelf)!;
  const open = items.find((item) => item.id === openId) ?? null;

  const decide = async (item: TenderSummary, decision: OperatorDecision, note?: string) => {
    setBusy(true);
    setError(null);
    try {
      const inbox = await window.tenderAssist.decideTenders([item.id], decision, note);
      onInboxCount?.(inbox.attentionCount);
      setDone(decision === 'REOPEN' ? 'Moved back to Today for review.' : 'Approved. Its folder is copied to Drive.');
      setOpenId(null);
      load();
    } catch (err) {
      setError(plainError(err));
    } finally {
      setBusy(false);
    }
  };

  if (open) {
    return (
      <div className="page page--desk">
        <button type="button" className="btn btn--quiet btn--small page__back" onClick={() => setOpenId(null)}><BackIcon /> {current.label}</button>
        {error && <p className="notice notice--stop" role="alert">{error}</p>}
        <TenderFile
          key={open.id}
          tender={open}
          busy={busy}
          actions={SHELF_ACTIONS[shelf].map((action) => ({
            id: action.decision, label: action.label, kind: action.kind, run: (note) => void decide(open, action.decision, note),
          }))}
          onDismissRelated={async (otherId) => { await window.tenderAssist.dismissRelatedTender(open.id, otherId); load(); }}
        />
      </div>
    );
  }

  return (
    <div className="page page--desk">
      <header className="page__head">
        <h1>Tenders</h1>
      </header>

      <div className="toolbar">
        <FilterPills label="Tender groups" value={shelf} onChange={(next) => { setShelf(next); setDone(null); }}
          options={SHELVES.map((entry) => ({ id: entry.id, label: entry.label, count: view ? view[entry.id].length : undefined }))} />
        <div className="toolbar__right">
          <label className="search">
            <SearchIcon />
            <span className="visually-hidden">Find a tender</span>
            <input type="search" value={query} placeholder="Title, department or ID" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label className="field field--inline">
            <span className="visually-hidden">Sort by</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              {(Object.keys(SORTS) as Sort[]).map((id) => <option key={id} value={id}>{SORTS[id].label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <p className="notice notice--stop" role="alert">{error}</p>}
      {done && <p className="decided" role="status">{done}</p>}
      {!view && <p className="page__empty">Loading…</p>}
      {view && filtered.length === 0 && (
        <div className="desk__empty"><h2>{needle ? 'No tenders match' : current.label}</h2><p>{needle ? 'Try other words, or another group above.' : current.empty}</p></div>
      )}
      {filtered.length > 0 && (
        <>
          <ul className="tcards">
            {shown.map((tender) => <TenderCard key={tender.id} tender={tender} onOpen={() => setOpenId(tender.id)} />)}
          </ul>
          <div className="table-card"><Pager page={page} pages={pages} total={filtered.length} size={12} onPage={setPage} noun="tenders" /></div>
        </>
      )}
    </div>
  );
}
