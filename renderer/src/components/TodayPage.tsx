import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DocumentsWaiting, InboxItem, InboxView, OperatorDecision, RecoveryJob, RunHistorySummary, RunSettingsState, SettingsSection } from '../../../src/electron/ipcTypes';
import type { PreflightReport } from '../../../src/system/preflight';
import { getPortalDefinition, isGemPortal } from '../../../src/config/portalRegistry';
import { LIFECYCLE_LABELS } from '../format';
import { PortalSelect } from './PortalSelect';
import { TenderFile, type FileAction } from './TenderFile';
import { TenderTray, type TrayGroup } from './TenderTray';
import { AlertIcon, ArrowRightIcon } from './icons';
import { plainError } from '../words';

export interface FinishedRun { jobId: string; message: string }

export interface TodayPageProps {
  settings: RunSettingsState | null;
  selectedPortalId: string;
  onPortalChange: (portalId: string) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onRunStarted: (jobId: string) => void;
  onOpenRun: (jobId: string) => void;
  onInboxCount: (count: number) => void;
  finishedRun: FinishedRun | null;
  onDismissFinished: () => void;
}

const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000) + 1;
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const DONE_MESSAGES: Record<OperatorDecision, string> = {
  APPROVE: 'Approved. Its folder is copied to Drive.',
  REJECT: 'Rejected.',
  DEFER: 'Moved to Later.',
  REOPEN: 'Moved back to review.',
};

const KEYS: Record<string, OperatorDecision> = { a: 'APPROVE', r: 'REJECT', d: 'DEFER' };

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

// A tender that changed after a decision can switch call, or keep its own.
const CHANGED_ALTERNATIVES: Record<string, OperatorDecision[]> = {
  APPROVED: ['REJECT'], DOCUMENTS_COLLECTED: ['REJECT'], DEFERRED: ['APPROVE', 'REJECT'], REJECTED: ['APPROVE'],
};

/** Today: find tenders for dates, and decide what is waiting, one file at a time. */
export function TodayPage({
  settings, selectedPortalId, onPortalChange, onOpenSettings, onRunStarted, onOpenRun, onInboxCount, finishedRun, onDismissFinished,
}: TodayPageProps) {
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [runAgain, setRunAgain] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [skippedNote, setSkippedNote] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [history, setHistory] = useState<RunHistorySummary>({ recentRunDates: [], missedDates: [] });
  const [recovery, setRecovery] = useState<RecoveryJob | null>(null);
  const [inbox, setInbox] = useState<InboxView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [documentsWaiting, setDocumentsWaiting] = useState<DocumentsWaiting | null>(null);
  const portal = getPortalDefinition(selectedPortalId);
  const gem = isGemPortal(portal);

  const loadDocumentsWaiting = useCallback(() => {
    window.tenderAssist.getDocumentsWaiting(selectedPortalId).then(setDocumentsWaiting).catch(() => {});
  }, [selectedPortalId]);
  useEffect(() => {
    loadDocumentsWaiting();
    return window.tenderAssist.onJobUpdate((update) => { if (update.outcome) loadDocumentsWaiting(); });
  }, [loadDocumentsWaiting]);

  const applyInbox = useCallback((view: InboxView) => {
    setInbox(view);
    onInboxCount(view.attentionCount);
  }, [onInboxCount]);

  const loadInbox = useCallback(() => {
    window.tenderAssist.getInbox().then(applyInbox).catch((err) => setDecideError(plainError(err)));
  }, [applyInbox]);

  useEffect(() => {
    loadInbox();
    window.tenderAssist.getRecoveryJob().then(setRecovery).catch(() => {});
    return window.tenderAssist.onJobUpdate((update) => { if (update.outcome) loadInbox(); });
  }, [loadInbox]);

  useEffect(() => {
    let current = true;
    Promise.all([window.tenderAssist.runPreflight(selectedPortalId), window.tenderAssist.getRunHistory(selectedPortalId)])
      .then(([report, nextHistory]) => { if (current) { setPreflight(report); setHistory(nextHistory); } })
      .catch(() => {});
    return () => { current = false; };
  }, [selectedPortalId]);

  // Waiting files in reading order: kept first, then needs a look, then changed, then rejects to check.
  const groups: TrayGroup[] = useMemo(() => inbox ? [
    { id: 'recommended', title: 'Kept by TenderAssist', hint: 'Matched your intent. Approve to keep working on them.', items: inbox.recommended },
    { id: 'uncertain', title: 'Needs a look', hint: 'TenderAssist could not decide.', items: inbox.uncertain },
    { id: 'changed', title: 'Changed since you decided', hint: 'Dates, value or a corrigendum changed.', items: inbox.changed },
    {
      id: 'rejected', title: 'Rejected by TenderAssist', hint: 'Check the rules caught the right ones.', items: inbox.autoRejected,
      footer: (
        <button type="button" className="btn btn--quiet btn--small" onClick={async () => {
          const runIds = [...new Set(inbox.autoRejected.map((item) => item.screeningJobId).filter((id): id is string => Boolean(id)))];
          applyInbox(await window.tenderAssist.acknowledgeRuns(runIds));
          setDone('Rejected tenders checked. They stay under Tenders → Rejected.');
        }}>These are right, clear them</button>
      ),
    },
  ] : [], [inbox, applyInbox]);

  const ordered: InboxItem[] = useMemo(() => inbox ? [...inbox.recommended, ...inbox.uncertain, ...inbox.changed, ...inbox.autoRejected] : [], [inbox]);
  const selected = ordered.find((item) => item.id === selectedId) ?? ordered[0] ?? null;

  const decide = useCallback(async (item: InboxItem, decision: OperatorDecision, note?: string) => {
    const index = ordered.findIndex((entry) => entry.id === item.id);
    setBusyId(item.id);
    setDecideError(null);
    try {
      const next = await window.tenderAssist.decideTenders([item.id], decision, note);
      applyInbox(next);
      if (decision === 'APPROVE') loadDocumentsWaiting();
      setDone(`${DONE_MESSAGES[decision]} ${item.title.length > 60 ? `${item.title.slice(0, 60)}…` : item.title}`);
      // Open whatever now sits where the decided file was.
      const nextOrdered = [...next.recommended, ...next.uncertain, ...next.changed, ...next.autoRejected];
      setSelectedId(nextOrdered[Math.min(index, nextOrdered.length - 1)]?.id ?? null);
    } catch (err) {
      setDecideError(plainError(err));
    } finally {
      setBusyId(null);
    }
  }, [applyInbox, ordered]);

  const keepDecision = useCallback(async (item: InboxItem) => {
    setBusyId(item.id);
    try {
      applyInbox(await window.tenderAssist.acknowledgeTenderChanges([item.id]));
      setDone('Decision kept. The change is in the tender’s history.');
    } catch (err) {
      setDecideError(plainError(err));
    } finally {
      setBusyId(null);
    }
  }, [applyInbox]);

  const actionsFor = (item: InboxItem): FileAction[] => {
    if (item.group === 'AUTO_REJECTED') {
      return [{ id: 'reopen', label: 'Move back to review', kind: 'plain', run: (note) => void decide(item, 'REOPEN', note) }];
    }
    if (item.group === 'CHANGED') {
      const keep: FileAction = {
        id: 'keep', kind: 'approve', run: () => void keepDecision(item),
        label: item.lifecycle === 'CANCELLED' ? 'OK, noted' : `Keep: ${LIFECYCLE_LABELS[item.lifecycle] ?? item.lifecycle}`,
      };
      const alternatives = (CHANGED_ALTERNATIVES[item.lifecycle] ?? []).map((decision): FileAction => ({
        id: decision, label: decision === 'APPROVE' ? 'Approve instead' : 'Reject instead',
        kind: decision === 'REJECT' ? 'reject' : 'plain', run: (note) => void decide(item, decision, note),
      }));
      return [keep, ...alternatives];
    }
    return [
      { id: 'approve', label: 'Approve', kind: 'approve', run: (note) => void decide(item, 'APPROVE', note) },
      { id: 'later', label: 'Later', kind: 'later', run: (note) => void decide(item, 'DEFER', note) },
      { id: 'reject', label: 'Reject', kind: 'reject', run: (note) => void decide(item, 'REJECT', note) },
    ];
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || !selected) return;
      const key = event.key.toLowerCase();
      const index = ordered.findIndex((item) => item.id === selected.id);
      if (key === 'j' || key === 'k') {
        event.preventDefault();
        const next = ordered[key === 'j' ? Math.min(index + 1, ordered.length - 1) : Math.max(index - 1, 0)];
        if (next) setSelectedId(next.id);
      } else if (KEYS[key] && (selected.group === 'RECOMMENDED' || selected.group === 'UNCERTAIN') && busyId !== selected.id) {
        event.preventDefault();
        void decide(selected, KEYS[key]);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busyId, decide, ordered, selected]);

  const dateCount = to >= from ? daysBetween(from, to) : 1;
  const blocker = preflight?.checks.find((check) => check.level === 'BLOCKED') ?? null;
  const warnings = preflight?.checks.filter((check) => check.level === 'WARNING') ?? [];

  const start = async () => {
    if (!settings?.configured) { onOpenSettings('relevance'); return; }
    setStarting(true);
    setStartError(null);
    setSkippedNote(null);
    onDismissFinished();
    try {
      const report = await window.tenderAssist.runPreflight(selectedPortalId);
      setPreflight(report);
      const block = report.checks.find((check) => check.level === 'BLOCKED');
      if (block) throw new Error(block.message);
      const { jobId, skipped } = await window.tenderAssist.startJob(
        { searchDate: from, portalId: selectedPortalId, ...settings.defaults },
        to > from ? to : from,
        { runAgain },
      );
      if (skipped.length > 0) setSkippedNote(`Already searched, skipped: ${skipped.map(shortDate).join(', ')}.`);
      onRunStarted(jobId);
    } catch (err) {
      setStartError(plainError(err));
    } finally {
      setStarting(false);
    }
  };

  const continueRecovery = async (mode: 'resume' | 'restart' | 'end') => {
    if (!recovery) return;
    setStartError(null);
    try {
      if (mode === 'end') {
        await window.tenderAssist.dismissRecoveryJob(recovery.jobId);
      } else if (mode === 'resume') {
        onPortalChange(recovery.config.portalId ?? selectedPortalId);
        const { jobId } = await window.tenderAssist.resumeJob(recovery.jobId);
        onRunStarted(jobId);
      } else {
        await window.tenderAssist.dismissRecoveryJob(recovery.jobId);
        onPortalChange(recovery.config.portalId ?? selectedPortalId);
        const { jobId } = await window.tenderAssist.startJob(recovery.config);
        onRunStarted(jobId);
      }
      setRecovery(null);
    } catch (err) {
      setStartError(plainError(err));
    }
  };

  const missed = history.missedDates;

  const collectDocuments = async () => {
    setStarting(true);
    setStartError(null);
    onDismissFinished();
    try {
      const { jobId } = await window.tenderAssist.startDocumentRun(selectedPortalId);
      onRunStarted(jobId);
    } catch (err) {
      setStartError(plainError(err));
    } finally {
      setStarting(false);
    }
  };
  const notInMyTenders = documentsWaiting?.notInMyTenders ?? [];
  const searchAgainDates = [...new Set(notInMyTenders.map((tender) => tender.foundOnDate).filter((date): date is string => Boolean(date)))].sort();

  return (
    <div className="today">
      <form className="find" onSubmit={(event) => { event.preventDefault(); void start(); }}>
        <h1 className="find__title">Find tenders</h1>
        <label className="field">
          <span>Website</span>
          <PortalSelect id="find-portal" value={selectedPortalId} onChange={onPortalChange} disabled={starting} />
        </label>
        <label className="field">
          <span>{gem ? 'Bids started from' : 'Published from'}</span>
          <input type="date" value={from} max={todayIso()} disabled={starting} onChange={(event) => {
            const next = event.target.value;
            if (to === from || to < next) setTo(next);
            setFrom(next);
          }} />
        </label>
        <label className="field">
          <span>to</span>
          <input type="date" value={to} min={from} max={todayIso()} disabled={starting} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label className="check" title="Search dates that already have a finished run again">
          <input type="checkbox" checked={runAgain} disabled={starting} onChange={(event) => setRunAgain(event.target.checked)} />
          Search already-run dates again
        </label>
        <button className="btn btn--primary btn--large" type="submit" disabled={starting || !settings || Boolean(blocker)}>
          {starting ? (gem ? 'Starting…' : 'Opening the portal…') : dateCount > 1 ? `Find tenders for ${dateCount} dates` : 'Find tenders'}
          {!starting && <ArrowRightIcon />}
        </button>
      </form>

      <div className="notices" aria-live="polite">
        {settings && !settings.configured && (
          <div className="notice notice--attention">
            <AlertIcon />
            <span>Tell TenderAssist what to look for before your first search.</span>
            <button type="button" className="btn btn--quiet btn--small" onClick={() => onOpenSettings('relevance')}>Open settings</button>
          </div>
        )}
        {blocker && (
          <div className="notice notice--stop" role="alert">
            <AlertIcon />
            <span><strong>{blocker.label}.</strong> {blocker.message}</span>
            {blocker.helpUrl && (
              <button type="button" className="btn btn--quiet btn--small" onClick={() => void window.tenderAssist.openHelpLink(blocker.helpUrl!)}>
                {blocker.id === 'jnlp' ? 'Download OpenWebStart' : 'Get help'}
              </button>
            )}
          </div>
        )}
        {!blocker && warnings.map((warning) => (
          <div key={warning.id} className="notice notice--quiet"><AlertIcon /><span><strong>{warning.label}:</strong> {warning.message}</span></div>
        ))}
        {startError && <div className="notice notice--stop" role="alert"><AlertIcon /><span>{startError}</span></div>}
        {skippedNote && <div className="notice notice--quiet"><span>{skippedNote}</span></div>}
        {recovery && (
          <div className="notice notice--attention">
            <AlertIcon />
            <span>
              The search for {shortDate(recovery.config.searchDate)} stopped before it finished. {recovery.resumeDescription}
            </span>
            {recovery.resume !== 'START_OVER' && <button type="button" className="btn btn--primary btn--small" onClick={() => void continueRecovery('resume')}>Continue it</button>}
            <button type="button" className="btn btn--quiet btn--small" onClick={() => void continueRecovery('restart')}>Start it again</button>
            <button type="button" className="btn btn--quiet btn--small" onClick={() => void continueRecovery('end')}>Leave it</button>
          </div>
        )}
        {finishedRun && (
          <div className="notice notice--done">
            <span>{finishedRun.message}</span>
            <button type="button" className="btn btn--quiet btn--small" onClick={() => onOpenRun(finishedRun.jobId)}>See what was checked</button>
            <button type="button" className="btn btn--quiet btn--small" onClick={onDismissFinished}>Dismiss</button>
          </div>
        )}
        {documentsWaiting && documentsWaiting.ready > 0 && (
          <div className="notice notice--attention">
            <AlertIcon />
            <span>
              <strong>{documentsWaiting.ready} approved {documentsWaiting.ready === 1 ? 'tender is' : 'tenders are'} waiting for {documentsWaiting.ready === 1 ? 'its' : 'their'} documents.</strong>{' '}
              {gem
                ? `TenderAssist saves the bid document and the buyer’s attachments straight from GeM. No sign-in, and nothing is searched again.`
                : <>TenderAssist signs in, opens only {documentsWaiting.ready === 1 ? 'that tender' : 'those tenders'} in My Tenders, and saves the documents and zip file. Nothing is searched again.</>}
            </span>
            <button type="button" className="btn btn--primary btn--small" disabled={starting || Boolean(blocker)} onClick={() => void collectDocuments()}>
              Collect their documents
            </button>
          </div>
        )}
        {notInMyTenders.length > 0 && (
          <div className="notice notice--quiet">
            <span>
              {notInMyTenders.length} approved {notInMyTenders.length === 1 ? 'tender never' : 'tenders never'} reached My Tenders, so {notInMyTenders.length === 1 ? 'its' : 'their'} documents cannot be collected yet.
              {searchAgainDates.length > 0 && ` Search ${searchAgainDates.map(shortDate).join(', ')} again to read ${notInMyTenders.length === 1 ? 'it' : 'them'}.`}
            </span>
            {searchAgainDates.length > 0 && (
              <button type="button" className="btn btn--quiet btn--small" onClick={() => { setFrom(searchAgainDates[0]); setTo(searchAgainDates[searchAgainDates.length - 1]); setRunAgain(true); }}>
                Use these dates
              </button>
            )}
          </div>
        )}
        {missed.length > 0 && !finishedRun && (
          <div className="notice notice--quiet">
            <span>Not searched yet: {missed.slice(0, 6).map(shortDate).join(', ')}{missed.length > 6 ? ` and ${missed.length - 6} more` : ''}.</span>
            <button type="button" className="btn btn--quiet btn--small" onClick={() => { setFrom(missed[0]); setTo(missed[missed.length - 1] ?? missed[0]); }}>
              Use these dates
            </button>
          </div>
        )}
      </div>

      <div className="desk">
        <TenderTray
          label="Tenders waiting for you"
          groups={groups}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          emptyText="Nothing is waiting for you."
        />
        <div className="desk__open">
          {decideError && <p className="notice notice--stop" role="alert"><AlertIcon /><span>{decideError}</span></p>}
          {done && <p className="decided" role="status">{done}</p>}
          {selected ? (
            <TenderFile
              key={selected.id}
              tender={selected}
              busy={busyId === selected.id}
              actions={actionsFor(selected)}
              waitingNote={selected.group === 'CHANGED' ? selected.explanation : undefined}
              onDismissRelated={async (otherId) => { await window.tenderAssist.dismissRelatedTender(selected.id, otherId); loadInbox(); }}
              onSearchDate={(date) => { setFrom(date); setTo(date); setRunAgain(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            />
          ) : inbox && (
            <div className="desk__empty">
              <h2>You are up to date</h2>
              <p>Tenders TenderAssist finds appear here, one file at a time. Choose published dates above and select Find tenders.</p>
              <p className="desk__keys">Tip: <kbd>J</kbd>/<kbd>K</kbd> move between files, <kbd>A</kbd> approve, <kbd>R</kbd> reject, <kbd>D</kbd> later.</p>
            </div>
          )}
          {!selected && !inbox && <p className="file-empty">Loading…</p>}
          {selected && <p className="desk__keys">Keys: <kbd>J</kbd>/<kbd>K</kbd> next or previous, <kbd>A</kbd> approve, <kbd>R</kbd> reject, <kbd>D</kbd> later.</p>}
        </div>
      </div>
    </div>
  );
}
