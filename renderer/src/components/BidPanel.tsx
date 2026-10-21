import { useEffect, useState } from 'react';
import type { BidChecklistView, BidProgress, OpportunityLifecycle } from '../../../src/electron/ipcTypes';

/** Where a bid stands, and the steps the bidder can mark next from there. */
const STEPS: Array<{ step: BidProgress; label: string; from: OpportunityLifecycle[] }> = [
  { step: 'PREPARING', label: 'Preparing the bid', from: ['APPROVED', 'DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'NOT_SUBMITTED', 'SUBMITTED'] },
  { step: 'SUBMITTED', label: 'Submitted', from: ['APPROVED', 'DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'PREPARING', 'EXPIRED', 'WON', 'LOST'] },
  { step: 'NOT_SUBMITTED', label: 'Not submitting', from: ['APPROVED', 'DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'PREPARING', 'EXPIRED'] },
  { step: 'WON', label: 'Won', from: ['SUBMITTED'] },
  { step: 'LOST', label: 'Lost', from: ['SUBMITTED'] },
];

const STANDING: Partial<Record<OpportunityLifecycle, string>> = {
  APPROVED: 'Approved: not started', DOCUMENTS_COLLECTED: 'Approved: documents saved', ELIGIBILITY_REVIEWED: 'Approved: eligibility read',
  PREPARING: 'Preparing the bid', SUBMITTED: 'Submitted: waiting for the result', NOT_SUBMITTED: 'Not submitted', WON: 'Won', LOST: 'Lost',
  EXPIRED: 'Closing date passed',
};

/**
 * The Bid tab of an approved tender's file: where the bid stands (preparing,
 * submitted, won or lost) and what to prepare and upload, ticked off as it
 * is done. Won and lost feed the reports on which words and categories win.
 */
export function BidPanel({ opportunityId, onProgress }: { opportunityId: string; onProgress?: (lifecycle: OpportunityLifecycle) => void }) {
  const [view, setView] = useState<BidChecklistView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    window.tenderAssist.getBidChecklist(opportunityId)
      .then((next) => { if (current) setView(next); })
      .catch((err) => { if (current) setError(err instanceof Error ? err.message : String(err)); });
    return () => { current = false; };
  }, [opportunityId]);

  if (error) return <p className="file-empty" role="alert">{error}</p>;
  if (!view) return <p className="hint">Loading…</p>;

  const done = view.items.filter((item) => item.done).length;
  const tick = async (key: string, next: boolean) => {
    setView({ ...view, items: view.items.map((item) => (item.key === key ? { ...item, done: next } : item)) });
    try { await window.tenderAssist.setChecklistTick(opportunityId, key, next); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const mark = async (step: BidProgress) => {
    setBusy(true);
    try {
      const lifecycle = await window.tenderAssist.markBidProgress(opportunityId, step);
      setView({ ...view, lifecycle });
      onProgress?.(lifecycle);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const next = STEPS.filter((entry) => entry.from.includes(view.lifecycle));

  return (
    <div className="bid">
      <section className="bid__progress" aria-label="Where the bid stands">
        <h3 className="unread__title">Where the bid stands</h3>
        <p className="bid__standing">{STANDING[view.lifecycle] ?? view.lifecycle}</p>
        {next.length > 0 && (
          <div className="bid__steps">
            {next.map((entry) => (
              <button key={entry.step} type="button" disabled={busy}
                className={entry.step === 'WON' ? 'btn btn--primary btn--small' : entry.step === 'LOST' || entry.step === 'NOT_SUBMITTED' ? 'btn btn--line btn--small' : 'btn btn--line btn--small'}
                onClick={() => void mark(entry.step)}>
                {entry.label}
              </button>
            ))}
          </div>
        )}
      </section>
      <section aria-label="What to prepare and upload">
        <h3 className="unread__title">What to prepare and upload <span className="bid__count">{done} of {view.items.length} done</span></h3>
        <ul className="bid__list">
          {view.items.map((item) => (
            <li key={item.key} className={item.done ? 'bid__item is-done' : 'bid__item'}>
              <label className="check">
                <input type="checkbox" checked={item.done} onChange={(event) => void tick(item.key, event.target.checked)} />
                <span>{item.label}<small className="bid__from">{item.from}</small></span>
              </label>
            </li>
          ))}
        </ul>
        <p className="hint">Worked out from the tender’s own fields and documents. Read the tender documents for anything else they ask for.</p>
      </section>
    </div>
  );
}
