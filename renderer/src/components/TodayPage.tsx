import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CategoryHealth, DocumentsWaiting, InboxItem, InboxView, OperatorDecision, RecoveryJob, RunHistorySummary, RunSettingsState, SettingsSection } from '../../../src/electron/ipcTypes';
import type { PreflightReport } from '../../../src/system/preflight';
import { getPortalDefinition, isGemPortal, PORTALS } from '../../../src/config/portalRegistry';
import { categoriesForPortal } from '../../../src/config/runConfiguration';
import { absoluteDateTime, LIFECYCLE_LABELS } from '../format';
import { PortalSelect } from './PortalSelect';
import { CategoryReplacement, withReplacements } from './CategoryReplacement';
import { TenderFile, type FileAction } from './TenderFile';
import { TenderTray, type TrayGroup } from './TenderTray';
import { Tracking } from './Tracking';
import { compactRupees, deadline, portalMark } from './TenderCard';
import { AlertIcon, ArrowRightIcon, BackIcon, CheckIcon, ClockIcon, CrossIcon, ListIcon, NoteIcon } from './icons';
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
  /** Settings changed here (a category replacement); the app keeps the new copy. */
  onSettingsSaved: (settings: RunSettingsState) => void;
}

const isoOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const todayIso = () => isoOf(new Date());
const daysAgo = (days: number) => { const date = new Date(); date.setDate(date.getDate() - days); return isoOf(date); };
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000) + 1;
}

/** One-click date ranges, so the common runs need no date picking. */
function datePresets(missed: string[]): Array<{ label: string; from: string; to: string }> {
  const presets = [
    { label: 'Today', from: todayIso(), to: todayIso() },
    { label: 'Yesterday', from: daysAgo(1), to: daysAgo(1) },
    { label: 'Last 3 days', from: daysAgo(2), to: todayIso() },
    { label: 'Last 7 days', from: daysAgo(6), to: todayIso() },
  ];
  if (missed.length > 0) presets.push({ label: `Not searched yet (${missed.length})`, from: missed[0], to: missed[missed.length - 1] });
  return presets;
}

const KEYS: Record<string, OperatorDecision> = { a: 'APPROVE', r: 'REJECT', d: 'DEFER' };
const STAMP: Record<OperatorDecision, { text: string; tone: string }> = {
  APPROVE: { text: 'Approved', tone: 'keep' },
  REJECT: { text: 'Rejected', tone: 'reject' },
  DEFER: { text: 'Later', tone: 'later' },
  REOPEN: { text: 'Back to review', tone: 'later' },
};
const GROUP_WORDS: Record<string, { text: string; tone: string }> = {
  RECOMMENDED: { text: 'Kept by TenderAssist', tone: 'keep' },
  UNCERTAIN: { text: 'TenderAssist is unsure', tone: 'look' },
  CHANGED: { text: 'Changed since you decided', tone: 'later' },
  AUTO_REJECTED: { text: 'Rejected by your rules', tone: 'reject' },
};
// A tender that changed after a decision can switch call, or keep its own.
const CHANGED_ALTERNATIVES: Record<string, OperatorDecision[]> = {
  APPROVED: ['REJECT'], DOCUMENTS_COLLECTED: ['REJECT'], DEFERRED: ['APPROVE', 'REJECT'], REJECTED: ['APPROVE'],
};

const skipKey = (portalId: string) => `tenderassist.categorySkip.${portalId}`;
function readSkippedMissing(portalId: string): string | null {
  try { return window.localStorage.getItem(skipKey(portalId)); } catch { return null; }
}
function writeSkippedMissing(portalId: string, key: string): void {
  try { window.localStorage.setItem(skipKey(portalId), key); } catch { /* the warning simply shows again */ }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Today: one next step at a time. Decide what is waiting, or find new tenders. */
export function TodayPage({
  settings, selectedPortalId, onPortalChange, onOpenSettings, onRunStarted, onOpenRun, onInboxCount, finishedRun, onDismissFinished, onSettingsSaved,
}: TodayPageProps) {
  const [mode, setMode] = useState<'decide' | 'find' | null>(null);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [customDates, setCustomDates] = useState(false);
  const [runAgain, setRunAgain] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [skippedNote, setSkippedNote] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [history, setHistory] = useState<RunHistorySummary>({ recentRunDates: [], missedDates: [] });
  const [recovery, setRecovery] = useState<RecoveryJob | null>(null);
  const [inbox, setInbox] = useState<InboxView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [stamp, setStamp] = useState<{ text: string; tone: string } | null>(null);
  const [checkRejectsOneByOne, setCheckRejectsOneByOne] = useState(false);
  const [drawer, setDrawer] = useState<'queue' | 'details' | null>(null);
  const [documentsWaiting, setDocumentsWaiting] = useState<DocumentsWaiting | null>(null);
  const [driveSet, setDriveSet] = useState(false);
  const portal = getPortalDefinition(selectedPortalId);
  const gem = isGemPortal(portal);
  const [categoryHealth, setCategoryHealth] = useState<CategoryHealth | null>(null);
  const [followed, setFollowed] = useState(0);

  useEffect(() => {
    let current = true;
    window.tenderAssist.getFollowedTenders(selectedPortalId)
      .then((result) => { if (current) setFollowed(result.followed); })
      .catch(() => { if (current) setFollowed(0); });
    return () => { current = false; };
  }, [selectedPortalId, finishedRun, inbox]);
  const [replacing, setReplacing] = useState(false);
  const [skippedMissing, setSkippedMissing] = useState<string | null>(() => readSkippedMissing(selectedPortalId));

  useEffect(() => {
    let current = true;
    setSkippedMissing(readSkippedMissing(selectedPortalId));
    window.tenderAssist.getCategoryHealth(selectedPortalId)
      .then((health) => { if (current) setCategoryHealth(health); })
      .catch(() => { if (current) setCategoryHealth(null); });
    return () => { current = false; };
  }, [selectedPortalId, settings]);

  const missingCategories = useMemo(() => categoryHealth?.missing ?? [], [categoryHealth]);
  const missingKey = missingCategories.map((item) => item.name.toLocaleLowerCase()).sort().join('|');
  // Skipping hides the warning until another category goes missing; Settings still shows them.
  const showMissing = missingCategories.length > 0 && skippedMissing !== missingKey;
  const skipMissing = () => {
    writeSkippedMissing(selectedPortalId, missingKey);
    setSkippedMissing(missingKey);
    setReplacing(false);
  };
  const applyReplacements = async (add: string[], remove: string[]) => {
    if (!settings) return;
    const chosen = categoriesForPortal(settings.defaults, portal);
    const next = withReplacements(chosen, add, remove);
    if (next.length === 0) { setStartError(`Keep at least one category for ${portal.name}.`); return; }
    try {
      onSettingsSaved(await window.tenderAssist.saveRunSettings({
        ...settings.defaults,
        categoriesByPortal: { ...settings.defaults.categoriesByPortal, [portal.id]: next },
      }));
      setReplacing(false);
    } catch (err) {
      setStartError(plainError(err));
    }
  };

  useEffect(() => {
    Promise.all([window.tenderAssist.getPublishingSettings(selectedPortalId), window.tenderAssist.getGoogleDrive()])
      .then(([publishing, drive]) => setDriveSet(Boolean(publishing.driveOutputRoot.trim()) || drive.signedIn))
      .catch(() => setDriveSet(false));
  }, [selectedPortalId]);

  const loadDocumentsWaiting = useCallback(() => {
    window.tenderAssist.getDocumentsWaiting(selectedPortalId).then(setDocumentsWaiting).catch(() => {});
  }, [selectedPortalId]);
  useEffect(() => {
    loadDocumentsWaiting();
    return window.tenderAssist.onJobUpdate((update) => { if (update.outcome) loadDocumentsWaiting(); });
  }, [loadDocumentsWaiting]);

  const applyInbox = useCallback((view: InboxView) => { setInbox(view); onInboxCount(view.attentionCount); }, [onInboxCount]);
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

  // Reading order: kept first, then unsure, then changed, then rule rejects to check.
  const ordered: InboxItem[] = useMemo(() => inbox ? [...inbox.recommended, ...inbox.uncertain, ...inbox.changed, ...inbox.autoRejected] : [], [inbox]);
  const personal = ordered.filter((item) => item.group !== 'AUTO_REJECTED');
  const rejects = inbox?.autoRejected ?? [];
  // Rule rejects are checked as one step ("these are right") unless asked one by one.
  const walk = checkRejectsOneByOne ? ordered : personal;
  const selected = walk.find((item) => item.id === selectedId) ?? walk[0] ?? null;
  const position = selected ? walk.findIndex((item) => item.id === selected.id) + 1 : 0;
  const showRejectStep = !selected && rejects.length > 0 && !checkRejectsOneByOne;

  // Open on the step that needs the operator: deciding when something waits, otherwise finding.
  useEffect(() => {
    if (mode === null && inbox) setMode(ordered.length > 0 ? 'decide' : 'find');
  }, [inbox, mode, ordered.length]);

  // The stamp is the confirmation, so it shows even with Windows animations off
  // (common on office PCs and remote sessions); it just lands without moving.
  const stampThen = useCallback((next: () => void, decision: OperatorDecision) => {
    setStamp(STAMP[decision]);
    window.setTimeout(() => { next(); setStamp(null); }, reducedMotion() ? 600 : 720);
  }, []);

  const decide = useCallback(async (item: InboxItem, decision: OperatorDecision, note?: string) => {
    const index = walk.findIndex((entry) => entry.id === item.id);
    setBusy(true);
    setDecideError(null);
    try {
      const next = await window.tenderAssist.decideTenders([item.id], decision, note);
      if (decision === 'APPROVE') loadDocumentsWaiting();
      stampThen(() => {
        applyInbox(next);
        const nextAll = [...next.recommended, ...next.uncertain, ...next.changed, ...next.autoRejected];
        const nextWalk = checkRejectsOneByOne ? nextAll : nextAll.filter((entry) => entry.group !== 'AUTO_REJECTED');
        setSelectedId(nextWalk[Math.min(index, nextWalk.length - 1)]?.id ?? null);
      }, decision);
    } catch (err) {
      setDecideError(plainError(err));
    } finally {
      setBusy(false);
    }
  }, [applyInbox, checkRejectsOneByOne, loadDocumentsWaiting, stampThen, walk]);

  const keepDecision = useCallback(async (item: InboxItem) => {
    setBusy(true);
    try { applyInbox(await window.tenderAssist.acknowledgeTenderChanges([item.id])); }
    catch (err) { setDecideError(plainError(err)); }
    finally { setBusy(false); }
  }, [applyInbox]);

  const clearRejects = async () => {
    const runIds = [...new Set(rejects.map((item) => item.screeningJobId).filter((id): id is string => Boolean(id)))];
    setBusy(true);
    try { applyInbox(await window.tenderAssist.acknowledgeRuns(runIds)); }
    catch (err) { setDecideError(plainError(err)); }
    finally { setBusy(false); }
  };

  const actionsFor = (item: InboxItem): FileAction[] => {
    if (item.group === 'AUTO_REJECTED') {
      return [
        { id: 'reject', label: 'Reject', kind: 'reject', run: (note) => void decide(item, 'REJECT', note) },
        { id: 'approve', label: 'Approve instead', kind: 'approve', run: (note) => void decide(item, 'APPROVE', note) },
        { id: 'later', label: 'Decide later', kind: 'later', run: (note) => void decide(item, 'DEFER', note) },
        { id: 'reopen', label: 'Move back to review', kind: 'plain', run: (note) => void decide(item, 'REOPEN', note) },
      ];
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
      { id: 'reject', label: 'Reject', kind: 'reject', run: (note) => void decide(item, 'REJECT', note) },
      { id: 'later', label: 'Decide later', kind: 'later', run: (note) => void decide(item, 'DEFER', note) },
    ];
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (mode !== 'decide' || drawer || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || !selected) return;
      const key = event.key.toLowerCase();
      const index = walk.findIndex((item) => item.id === selected.id);
      if (key === 'j' || key === 'k') {
        event.preventDefault();
        const next = walk[key === 'j' ? Math.min(index + 1, walk.length - 1) : Math.max(index - 1, 0)];
        if (next) setSelectedId(next.id);
      } else if (KEYS[key] && selected.group !== 'CHANGED' && !busy) {
        event.preventDefault();
        void decide(selected, KEYS[key]);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, decide, drawer, mode, selected, walk]);

  const dateCount = to >= from ? daysBetween(from, to) : 1;
  const blocker = preflight?.checks.find((check) => check.level === 'BLOCKED') ?? null;
  const warnings = preflight?.checks.filter((check) => check.level === 'WARNING') ?? [];
  const missed = history.missedDates;

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
        { searchDate: from, portalId: selectedPortalId, ...settings.defaults }, to > from ? to : from, { runAgain },
      );
      if (skipped.length > 0) setSkippedNote(`Already searched, skipped: ${skipped.map(shortDate).join(', ')}.`);
      onRunStarted(jobId);
    } catch (err) {
      setStartError(plainError(err));
    } finally {
      setStarting(false);
    }
  };

  const continueRecovery = async (choice: 'resume' | 'restart' | 'end') => {
    if (!recovery) return;
    setStartError(null);
    try {
      if (choice === 'end') {
        await window.tenderAssist.dismissRecoveryJob(recovery.jobId);
      } else if (choice === 'resume') {
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
  const checkForChanges = async () => {
    setStarting(true);
    setStartError(null);
    onDismissFinished();
    try {
      const { jobId } = await window.tenderAssist.startChangeCheck(selectedPortalId);
      onRunStarted(jobId);
    } catch (err) {
      setStartError(plainError(err));
    } finally {
      setStarting(false);
    }
  };
  const notInMyTenders = documentsWaiting?.notInMyTenders ?? [];
  const searchAgainDates = [...new Set(notInMyTenders.map((tender) => tender.foundOnDate).filter((date): date is string => Boolean(date)))].sort();

  // The websites shown as one-click choices: the chosen one, Tamil Nadu and GeM.
  const quickPortals = [...new Set([selectedPortalId, 'tamil-nadu', 'gem'])].map((id) => getPortalDefinition(id));

  const rangeLabel = from === to ? shortDate(from) : `${shortDate(from)} to ${shortDate(to)}`;

  const queueGroups: TrayGroup[] = inbox ? [
    { id: 'recommended', title: 'Kept by TenderAssist', items: inbox.recommended },
    { id: 'uncertain', title: 'TenderAssist is unsure', items: inbox.uncertain },
    { id: 'changed', title: 'Changed since you decided', items: inbox.changed },
    { id: 'rejected', title: 'Rejected by your rules', items: inbox.autoRejected, quietClosing: true },
  ] : [];

  return (
    <div className="today">
      <header className="today__head">
        <h1 className="visually-hidden">{mode === 'find' ? 'Find new tenders' : selected || showRejectStep ? 'Decide what is waiting' : 'All decided'}</h1>
        <div className="switch" role="tablist" aria-label="Today">
          <button type="button" role="tab" aria-selected={mode !== 'find'} className="switch__opt" onClick={() => setMode('decide')}>
            Decide
          </button>
          <button type="button" role="tab" aria-selected={mode === 'find'} className="switch__opt" onClick={() => setMode('find')}>Find tenders</button>
        </div>
      </header>

      {mode === 'find' ? (
        <div className="find">
          <form className="guide" onSubmit={(event) => { event.preventDefault(); void start(); }}>
            <section className="guide__step">
              <h2 className="guide__q">Which website?</h2>
              <div className="tiles" role="radiogroup" aria-label="Website">
                {quickPortals.map((entry) => (
                  <button key={entry.id} type="button" role="radio" aria-checked={entry.id === selectedPortalId}
                    className={entry.id === selectedPortalId ? 'tile is-on' : 'tile'} disabled={starting} onClick={() => onPortalChange(entry.id)}>
                    <span className="tile__mark">{portalMark(entry.id)}</span>
                    <span className="tile__name">{isGemPortal(entry) ? 'GeM' : entry.name}</span>
                    <span className="tile__hint">{isGemPortal(entry) ? 'No sign-in' : 'CAPTCHA and DSC'}</span>
                  </button>
                ))}
                <label className="tile tile--other">
                  <span className="tile__hint">Another website</span>
                  <PortalSelect id="find-portal" value={quickPortals.some((entry) => entry.id === selectedPortalId) ? '' : selectedPortalId}
                    onChange={(next) => { if (next) onPortalChange(next); }} disabled={starting} placeholder={`${PORTALS.length} websites`} />
                </label>
              </div>
            </section>

            <section className="guide__step">
              <h2 className="guide__q">{gem ? 'Bids started on which days?' : 'Published on which days?'}</h2>
              <div className="presets" role="group" aria-label="Quick dates">
                {datePresets(missed).map((preset) => (
                  <button key={preset.label} type="button" className={!customDates && preset.from === from && preset.to === to ? 'preset is-on' : 'preset'} disabled={starting}
                    onClick={() => { setFrom(preset.from); setTo(preset.to); setCustomDates(false); }}>
                    {preset.label}
                  </button>
                ))}
                <button type="button" className={customDates ? 'preset is-on' : 'preset'} onClick={() => setCustomDates(!customDates)}>Choose dates</button>
              </div>
              {customDates && (
                <div className="dates-pick">
                  <label className="field"><span>From</span>
                    <input type="date" value={from} max={todayIso()} disabled={starting} onChange={(event) => {
                      const next = event.target.value;
                      if (to === from || to < next) setTo(next);
                      setFrom(next);
                    }} />
                  </label>
                  <label className="field"><span>To</span>
                    <input type="date" value={to} min={from} max={todayIso()} disabled={starting} onChange={(event) => setTo(event.target.value)} />
                  </label>
                </div>
              )}
              <label className="check">
                <input type="checkbox" checked={runAgain} disabled={starting} onChange={(event) => setRunAgain(event.target.checked)} />
                Also search days already searched
              </label>
            </section>

            <footer className="guide__go">
              <div className="guide__summary">
                <span className="guide__big">{rangeLabel}</span>
                <span className="guide__small">{dateCount > 1 ? `${dateCount} days on ` : 'On '}{isGemPortal(portal) ? 'GeM' : portal.name}{gem ? ', no sign-in needed' : '. You type the CAPTCHA and DSC PIN'}</span>
              </div>
              <button className="btn btn--red btn--xl" type="submit" disabled={starting || !settings || Boolean(blocker)}>
                {starting ? (gem ? 'Starting' : 'Opening the website') : 'Start'}
                {!starting && <ArrowRightIcon />}
              </button>
            </footer>
          </form>

          <aside className="alerts" aria-live="polite">
            {settings && !settings.configured && (
              <div className="alert alert--look">
                <AlertIcon /><p>Tell TenderAssist what to look for before the first search.</p>
                <button type="button" className="btn btn--line btn--sm" onClick={() => onOpenSettings('relevance')}>Open settings</button>
              </div>
            )}
            {blocker && (
              <div className="alert alert--stop" role="alert">
                <AlertIcon /><p><strong>{blocker.label}.</strong> {blocker.message}</p>
                {blocker.helpUrl && (
                  <button type="button" className="btn btn--line btn--sm" onClick={() => void window.tenderAssist.openHelpLink(blocker.helpUrl!)}>
                    {blocker.id === 'jnlp' ? 'Download OpenWebStart' : 'Get help'}
                  </button>
                )}
              </div>
            )}
            {startError && <div className="alert alert--stop" role="alert"><AlertIcon /><p>{startError}</p></div>}
            {showMissing && (
              <div className="alert alert--look">
                <AlertIcon />
                <p>
                  <strong>{missingCategories.map((item) => `“${item.name}”`).join(', ')} {missingCategories.length === 1 ? 'is' : 'are'} not on {portal.name}’s category list</strong>
                  {categoryHealth?.readAt && ` (read ${absoluteDateTime(categoryHealth.readAt)})`}. The search skips {missingCategories.length === 1 ? 'it' : 'them'}.
                  Choose a category to search instead, or skip this for now and change it later in Settings.
                </p>
                <div className="alert__actions">
                  <button type="button" className="btn btn--line btn--sm" onClick={() => setReplacing(true)}>Choose replacements</button>
                  <button type="button" className="btn btn--text btn--sm" onClick={skipMissing}>Skip for now</button>
                </div>
              </div>
            )}
            {skippedNote && <div className="alert"><p>{skippedNote}</p></div>}
            {recovery && (
              <div className="alert alert--look">
                <AlertIcon />
                <p>The search for {shortDate(recovery.config.searchDate)} stopped before it finished. {recovery.resumeDescription}</p>
                <div className="alert__actions">
                  {recovery.resume !== 'START_OVER' && <button type="button" className="btn btn--red btn--sm" onClick={() => void continueRecovery('resume')}>Continue it</button>}
                  <button type="button" className="btn btn--line btn--sm" onClick={() => void continueRecovery('restart')}>Start again</button>
                  <button type="button" className="btn btn--text btn--sm" onClick={() => void continueRecovery('end')}>Leave it</button>
                </div>
              </div>
            )}
            {documentsWaiting && documentsWaiting.ready > 0 && (
              <div className="alert alert--blue">
                <p><strong>{documentsWaiting.ready} approved {documentsWaiting.ready === 1 ? 'tender needs' : 'tenders need'} {documentsWaiting.ready === 1 ? 'its' : 'their'} documents.</strong> {gem ? 'Saved straight from GeM, no sign-in.' : 'TenderAssist opens only those in My Tenders.'}</p>
                <button type="button" className="btn btn--line btn--sm" disabled={starting || Boolean(blocker)} onClick={() => void collectDocuments()}>Collect documents</button>
              </div>
            )}
            {followed > 0 && (
              <div className="alert alert--blue">
                <p>
                  <strong>{followed} {followed === 1 ? 'tender' : 'tenders'} you follow</strong> (approved, for later, or waiting for you) {followed === 1 ? 'is' : 'are'} checked for extended closing dates and corrigenda at the end of every search.
                  {gem ? ' GeM needs no sign-in.' : ' Checking now signs in to the website first.'}
                </p>
                <button type="button" className="btn btn--line btn--sm" disabled={starting || Boolean(blocker)} onClick={() => void checkForChanges()}>Check for changes</button>
              </div>
            )}
            {notInMyTenders.length > 0 && (
              <div className="alert">
                <p>{notInMyTenders.length} approved {notInMyTenders.length === 1 ? 'tender never' : 'tenders never'} reached My Tenders.{searchAgainDates.length > 0 && ` Search ${searchAgainDates.map(shortDate).join(', ')} again to read ${notInMyTenders.length === 1 ? 'it' : 'them'}.`}</p>
                {searchAgainDates.length > 0 && (
                  <button type="button" className="btn btn--line btn--sm" onClick={() => { setFrom(searchAgainDates[0]); setTo(searchAgainDates[searchAgainDates.length - 1]); setRunAgain(true); setCustomDates(true); }}>Use these days</button>
                )}
              </div>
            )}
            {finishedRun && (
              <div className="alert alert--keep">
                <CheckIcon /><p>{finishedRun.message}</p>
                <div className="alert__actions">
                  <button type="button" className="btn btn--line btn--sm" onClick={() => onOpenRun(finishedRun.jobId)}>See the run</button>
                  <button type="button" className="btn btn--text btn--sm" onClick={onDismissFinished}>Dismiss</button>
                </div>
              </div>
            )}
            {!blocker && warnings.map((warning) => (
              <div key={warning.id} className="alert"><AlertIcon /><p><strong>{warning.label}:</strong> {warning.message}</p></div>
            ))}
          </aside>
        </div>
      ) : (
        <div className="decide">
          {decideError && <div className="alert alert--stop" role="alert"><AlertIcon /><p>{decideError}</p></div>}
          {!inbox && <div className="consignment consignment--loading" aria-busy="true"><span /><span /><span /></div>}

          {inbox && selected && (
            <>
              <div className="decide__bar">
                <span className="decide__count"><strong>{position}</strong> of {walk.length}</span>
                <span className="decide__progress" aria-hidden="true"><span style={{ transform: `scaleX(${position / walk.length})` }} /></span>
                <span className="decide__nav">
                  <button type="button" className="btn btn--line btn--sm" disabled={position <= 1} onClick={() => setSelectedId(walk[position - 2].id)}><BackIcon /> Previous</button>
                  <button type="button" className="btn btn--line btn--sm" disabled={position >= walk.length} onClick={() => setSelectedId(walk[position].id)}>Next <ArrowRightIcon /></button>
                  <button type="button" className="btn btn--text btn--sm" onClick={() => setDrawer('queue')}><ListIcon /> See all</button>
                </span>
              </div>
              <Consignment
                key={selected.id}
                item={selected}
                busy={busy}
                stamp={stamp}
                actions={actionsFor(selected)}
                driveSet={driveSet}
                onDetails={() => setDrawer('details')}
              />
              <p className="decide__keys"><kbd>A</kbd> approve <kbd>R</kbd> reject <kbd>D</kbd> later <kbd>J</kbd><kbd>K</kbd> next, previous</p>
            </>
          )}

          {inbox && showRejectStep && (
            <section className="rulecheck">
              <h2>Your rules rejected {rejects.length} {rejects.length === 1 ? 'tender' : 'tenders'}</h2>
              <p>A quick look keeps the rules honest. If these are right, clear them in one go.</p>
              <ul className="rulecheck__list">
                {rejects.slice(0, 5).map((item) => (
                  <li key={item.id}><span className="rulecheck__title">{item.title}</span><span className="rulecheck__why">{item.matchedExclusions.length > 0 ? `Has “${item.matchedExclusions.join('”, “')}”` : item.explanation}</span></li>
                ))}
                {rejects.length > 5 && <li className="rulecheck__more">and {rejects.length - 5} more</li>}
              </ul>
              <div className="rulecheck__actions">
                <button type="button" className="btn btn--red btn--lg" disabled={busy} onClick={() => void clearRejects()}><CheckIcon /> These are right</button>
                <button type="button" className="btn btn--line btn--lg" onClick={() => { setCheckRejectsOneByOne(true); setSelectedId(rejects[0]?.id ?? null); }}>Check one by one</button>
              </div>
            </section>
          )}

          {inbox && !selected && !showRejectStep && (
            <section className="alldone">
              <Postmark text="All done" tone="done" still />
              <h2>Nothing is waiting for you</h2>
              <p>Every tender found so far is decided.</p>
              <button type="button" className="btn btn--primary btn--lg" onClick={() => setMode('find')}>Find new tenders <ArrowRightIcon /></button>
            </section>
          )}
        </div>
      )}

      {replacing && settings && (
        <CategoryReplacement portalId={portal.id} portalName={portal.name} missing={missingCategories}
          chosen={categoriesForPortal(settings.defaults, portal)} includeProducts={gem && settings.defaults.gemIncludeProducts}
          onSkip={skipMissing} onClose={() => setReplacing(false)} onApply={(add, remove) => void applyReplacements(add, remove)} />
      )}

      {drawer && (
        <Drawer title={drawer === 'queue' ? 'Waiting for you' : selected?.title ?? 'Tender'} onClose={() => setDrawer(null)}>
          {drawer === 'queue' ? (
            <TenderTray label="Waiting for you" groups={queueGroups} selectedId={selected?.id ?? null}
              onSelect={(id) => { if (rejects.some((item) => item.id === id)) setCheckRejectsOneByOne(true); setSelectedId(id); setDrawer(null); setMode('decide'); }}
              emptyText="Nothing is waiting." />
          ) : selected && (
            <TenderFile tender={selected} actions={[]}
              waitingNote={selected.group === 'CHANGED' ? selected.explanation : undefined}
              onDismissRelated={async (otherId) => { await window.tenderAssist.dismissRelatedTender(selected.id, otherId); loadInbox(); }}
              onSearchDate={(date) => { setFrom(date); setTo(date); setRunAgain(true); setCustomDates(true); setDrawer(null); setMode('find'); }} />
          )}
        </Drawer>
      )}
    </div>
  );
}

/** One tender to decide, shown like a tracked consignment, stamped when decided. */
function Consignment({ item, busy, stamp, actions, driveSet, onDetails }: {
  item: InboxItem; busy: boolean; stamp: { text: string; tone: string } | null; actions: FileAction[]; driveSet: boolean; onDetails: () => void;
}) {
  const [note, setNote] = useState('');
  const [noting, setNoting] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (noting) noteRef.current?.focus(); }, [noting]);
  const time = deadline(item.closingAt, item.publishedDate);
  const value = compactRupees(item.value);
  const group = GROUP_WORDS[item.group] ?? GROUP_WORDS.RECOMMENDED;
  const department = item.department || item.organisation?.split('||')[0] || 'Department not stated';
  const trimmed = note.trim() || undefined;
  const primary = actions.find((action) => action.kind === 'approve');
  const rejects = actions.filter((action) => action.kind === 'reject');
  const others = actions.filter((action) => action.kind === 'plain' || action.kind === 'later');

  return (
    <article className={`consignment${stamp ? ' is-stamped' : ''}`} aria-busy={busy} aria-label={item.title}>
      <header className="consignment__top">
        <span className="consignment__id"><span className="consignment__site">{portalMark(item.portalId)}</span>{item.tenderId}</span>
        {(item.group === 'CHANGED' || item.group === 'AUTO_REJECTED') && <span className={`tag tag--${group.tone}`}>{group.text}</span>}
      </header>
      <Tracking tender={item} />
      <h2 className="consignment__title">{item.title}</h2>
      <p className="consignment__dept">{department}</p>

      <dl className="facts3">
        <div><dt>Value</dt><dd title={value?.full}>{value?.short ?? 'Not stated'}</dd></div>
        <div className={`facts3__time facts3__time--${time.urgency}`}>
          <dt>Closes</dt>
          <dd title={item.closingAt ? absoluteDateTime(item.closingAt) : item.closingDate ?? undefined}>
            {time.urgency === 'unknown' ? (item.closingDate ?? 'Not captured') : time.left}
          </dd>
        </div>
        <div><dt>Published</dt><dd>{item.publishedDate ? new Date(item.publishedDate.length <= 10 ? `${item.publishedDate}T00:00:00` : item.publishedDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Not recorded'}</dd></div>
      </dl>

      <p className="consignment__why"><span>Why</span>{item.explanation}</p>

      <div className="consignment__more">
        <button type="button" className="btn btn--text btn--sm" onClick={onDetails}>Read the full tender</button>
        {!noting && <button type="button" className="btn btn--text btn--sm" onClick={() => setNoting(true)}><NoteIcon /> Add a note</button>}
      </div>
      {noting && (
        <textarea ref={noteRef} className="consignment__note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={1000}
          placeholder="Why you decided this (optional)" aria-label="Your note" />
      )}

      <footer className="consignment__act">
        {primary && (
          <button type="button" className="btn btn--red btn--xl" disabled={busy} onClick={() => primary.run(trimmed)}>
            <CheckIcon /> {primary.label}
          </button>
        )}
        {rejects.map((action) => (
          <button key={action.id} type="button" className="btn btn--quietline" disabled={busy} onClick={() => action.run(trimmed)}>
            <CrossIcon /> {action.label}
          </button>
        ))}
        {others.map((action) => (
          <button key={action.id} type="button" className={action.kind === 'later' ? 'btn btn--text' : 'btn btn--line btn--xl'} disabled={busy} onClick={() => action.run(trimmed)}>
            {action.kind === 'later' && <ClockIcon />} {action.label}
          </button>
        ))}
        {primary?.id === 'approve' && <span className="consignment__hint">{driveSet ? 'Approving saves its files and copies them to Drive.' : 'Approving saves its files.'}</span>}
      </footer>

      {stamp && <Postmark text={stamp.text} tone={stamp.tone} />}
    </article>
  );
}

/**
 * A round date postmark, drawn like India Post's cancellation: the office
 * name around the ring, a date bar across the middle, wavy cancel lines.
 */
function Postmark({ text, tone, still = false }: { text: string; tone: string; still?: boolean }) {
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase();
  return (
    <span className={`postmark postmark--${tone}${still ? ' postmark--still' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 260 160" width="260" height="160">
        <defs><path id="pm-ring" d="M 80 80 m -50 0 a 50 50 0 1 1 100 0 a 50 50 0 1 1 -100 0" /></defs>
        <circle cx="80" cy="80" r="66" fill="none" stroke="currentColor" strokeWidth="4" />
        <circle cx="80" cy="80" r="40" fill="none" stroke="currentColor" strokeWidth="2" />
        <text fontFamily="'Barlow Condensed', sans-serif" fontWeight="600" fontSize="15" letterSpacing="3" fill="currentColor">
          <textPath href="#pm-ring" startOffset="0">TENDERASSIST · SPEED POST ·</textPath>
        </text>
        <rect x="34" y="66" width="92" height="28" fill="var(--sheet)" />
        <line x1="34" y1="66" x2="126" y2="66" stroke="currentColor" strokeWidth="2" />
        <line x1="34" y1="94" x2="126" y2="94" stroke="currentColor" strokeWidth="2" />
        <text x="80" y="87" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="700" fontSize="19" letterSpacing="1" fill="currentColor">{date}</text>
        {[52, 68, 92, 108].map((y) => (
          <path key={y} d={`M 152 ${y} q 13 -9 26 0 t 26 0 t 26 0 t 26 0`} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
        ))}
      </svg>
      <span className="postmark__word">{text}</span>
    </span>
  );
}

/** A panel that slides in from the right, over the page, for the queue or a tender's full details. */
function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="drawer__scrim" aria-label="Close" onClick={onClose} />
      <div className="drawer__panel">
        <header className="drawer__head">
          <h2>{title}</h2>
          <button type="button" className="btn btn--text btn--sm" onClick={onClose}><CrossIcon /> Close</button>
        </header>
        <div className="drawer__body">{children}</div>
      </div>
    </div>
  );
}
