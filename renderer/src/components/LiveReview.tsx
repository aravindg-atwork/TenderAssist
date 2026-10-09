import { useCallback, useEffect, useState } from 'react';
import type { LiveSessionTender, LiveSessionView, OperatorDecision, TenderSummary } from '../../../src/electron/ipcTypes';
import { TenderFile, type FileAction } from './TenderFile';
import { BackIcon, CrossIcon } from './icons';
import { plainError, plural } from '../words';

type Filter = 'ALL' | 'KEEP' | 'UNCERTAIN' | 'REJECT';

const VERDICT: Record<string, { text: string; tone: string }> = {
  KEEP: { text: 'Kept', tone: 'keep' },
  UNCERTAIN: { text: 'Unsure', tone: 'look' },
  REJECT: { text: 'Rejected', tone: 'reject' },
};
const DECIDED: Record<string, string> = {
  APPROVED: 'Approved by you', DOCUMENTS_COLLECTED: 'Approved, files saved', REJECTED: 'Rejected by you', DEFERRED: 'Later',
};

export interface LiveReviewProps {
  portalName: string;
  onClose: () => void;
  /** Collect the approved tenders' documents now, in this sign-in. */
  onCollect: () => void;
}

/**
 * "This search": every tender the live sign-in found, with TenderAssist's
 * verdict and why. A tender the rules rejected can be approved here, and
 * its documents collected before signing out.
 */
export function LiveReview({ portalName, onClose, onCollect }: LiveReviewProps) {
  const [view, setView] = useState<LiveSessionView | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The tender opened as its full file: the same file Today and Tenders show.
  const [openTender, setOpenTender] = useState<TenderSummary | null>(null);

  const load = useCallback(() => window.tenderAssist.getLiveSession().then(setView).catch((err) => setError(plainError(err))), []);
  useEffect(() => { void load(); }, [load]);
  // The website is a window drawn above the app; hide it while this list is open.
  useEffect(() => {
    void window.tenderAssist.setPortalVisible(false);
    return () => { void window.tenderAssist.setPortalVisible(true); };
  }, []);
  useEffect(() => {
    // Escape steps back from an open file to the list first, then closes.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (openTender) setOpenTender(null); else onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, openTender]);

  const openFile = (opportunityId: string) => {
    setError(null);
    window.tenderAssist.getTenderSummary(opportunityId).then(setOpenTender).catch((err) => setError(plainError(err)));
  };
  const decideOpen = async (tender: TenderSummary, decision: OperatorDecision, note?: string) => {
    setBusy(tender.id);
    setError(null);
    try {
      await window.tenderAssist.decideTenders([tender.id], decision, note);
      setOpenTender(await window.tenderAssist.getTenderSummary(tender.id));
      await load();
    } catch (err) { setError(plainError(err)); }
    finally { setBusy(null); }
  };

  const decide = async (tender: LiveSessionTender, decision: OperatorDecision) => {
    setBusy(tender.opportunityId);
    setError(null);
    try { await window.tenderAssist.decideTenders([tender.opportunityId], decision); await load(); }
    catch (err) { setError(plainError(err)); }
    finally { setBusy(null); }
  };

  const all = view?.tenders ?? [];
  const count = (verdict: Filter) => all.filter((tender) => tender.recommendation === verdict).length;
  const shown = filter === 'ALL' ? all : all.filter((tender) => tender.recommendation === filter);
  const waiting = view?.approvedWaitingForDocuments ?? 0;
  const fileActions: FileAction[] = openTender ? [
    { id: 'approve', label: openTender.recommendation === 'REJECT' ? 'Approve anyway' : 'Approve', kind: 'approve', run: (note) => void decideOpen(openTender, 'APPROVE', note) },
    { id: 'later', label: 'Decide later', kind: 'later', run: (note) => void decideOpen(openTender, 'DEFER', note) },
    { id: 'reject', label: 'Reject', kind: 'reject', run: (note) => void decideOpen(openTender, 'REJECT', note) },
  ] : [];

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label="This search">
      <button type="button" className="drawer__scrim" aria-label="Close" onClick={onClose} />
      <div className="drawer__panel">
        <header className="drawer__head">
          <h2>This search on {portalName}</h2>
          <button type="button" className="btn btn--text btn--sm" onClick={onClose}><CrossIcon /> Close</button>
        </header>
        {openTender ? (
          <div className="drawer__body">
            <button type="button" className="btn btn--quiet btn--small page__back" onClick={() => setOpenTender(null)}><BackIcon /> All tenders in this search</button>
            {error && <div className="alert alert--stop" role="alert"><p>{error}</p></div>}
            <TenderFile key={openTender.id} tender={openTender} busy={busy !== null} actions={fileActions} />
          </div>
        ) : (
        <div className="drawer__body replace">
          <p className="replace__intro">
            Every tender this sign-in found, with TenderAssist’s verdict and why. Approve one the rules rejected, then collect its documents before you sign out.
          </p>
          {error && <div className="alert alert--stop" role="alert"><p>{error}</p></div>}
          <div className="switch" role="tablist" aria-label="Show">
            {(['ALL', 'KEEP', 'UNCERTAIN', 'REJECT'] as Filter[]).map((key) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} className="switch__opt" onClick={() => setFilter(key)}>
                {key === 'ALL' ? `All ${all.length}` : `${VERDICT[key].text} ${count(key)}`}
              </button>
            ))}
          </div>
          {!view && <p className="replace__loading" aria-busy="true">Loading…</p>}
          {view && shown.length === 0 && <p className="replace__meta">{all.length === 0 ? 'No tender was found in your categories during this sign-in.' : 'None in this group.'}</p>}
          <ul className="live-list">
            {shown.map((tender) => {
              const verdict = VERDICT[tender.recommendation ?? 'UNCERTAIN'];
              const decided = DECIDED[tender.lifecycle];
              return (
                <li key={tender.opportunityId} className="live-item">
                  <div className="live-item__head">
                    <span className={`mark mark--${verdict.tone}`}>{verdict.text}</span>
                    {decided && <span className="live-item__decided">{decided}{tender.filesSaved && !decided.includes('files') ? ', files saved' : ''}</span>}
                  </div>
                  <strong className="live-item__title">{tender.title}</strong>
                  <span className="live-item__meta">{[tender.tenderId, tender.organisation, tender.closingDate && `closes ${tender.closingDate}`].filter(Boolean).join(' · ')}</span>
                  <span className="live-item__why">{tender.reason}</span>
                  <div className="live-item__actions">
                    <button type="button" className="btn btn--quiet btn--sm" disabled={busy !== null} onClick={() => openFile(tender.opportunityId)}>Open full file</button>
                    {tender.lifecycle !== 'APPROVED' && tender.lifecycle !== 'DOCUMENTS_COLLECTED' && (
                      <button type="button" className="btn btn--line btn--sm" disabled={busy !== null} onClick={() => void decide(tender, 'APPROVE')}>
                        {tender.recommendation === 'REJECT' ? 'Approve anyway' : 'Approve'}
                      </button>
                    )}
                    {tender.lifecycle !== 'REJECTED' && (
                      <button type="button" className="btn btn--text btn--sm" disabled={busy !== null} onClick={() => void decide(tender, 'REJECT')}>Reject</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        )}
        <footer className="replace__foot">
          <span className="replace__meta">{waiting > 0 ? `${plural(waiting, 'approved tender')} ${waiting === 1 ? 'needs its' : 'need their'} documents.` : 'No approved tender is waiting for documents.'}</span>
          <button type="button" className="btn btn--red" disabled={waiting === 0} onClick={onCollect}>Collect documents now</button>
        </footer>
      </div>
    </div>
  );
}
