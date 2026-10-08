// renderer/src/App.tsx
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { AuthJobUpdate, RunSettingsState, SettingsSection } from '../../src/electron/ipcTypes';
import { DEFAULT_PORTAL_ID, getPortalDefinition, isGemPortal } from '../../src/config/portalRegistry';
import { applyTextSize } from './display';
import { TodayPage, type FinishedRun } from './components/TodayPage';
import { TendersPage } from './components/TendersPage';
import { RunsPage } from './components/RunsPage';
import { RunDetail } from './components/RunDetail';
import { SettingsPage } from './components/SettingsPage';
import { RunWorkspace } from './components/RunWorkspace';
import { RunPanel } from './components/RunPanel';
import { BrandMark, HistoryIcon, MoreIcon, SettingsIcon, StackIcon, TodayIcon } from './components/icons';
import { SessionReport } from './components/SessionReport';

type View = 'today' | 'tenders' | 'runs' | 'settings';

const NAV: Array<{ id: View; label: string; icon: () => ReactElement }> = [
  { id: 'today', label: 'Today', icon: TodayIcon },
  { id: 'tenders', label: 'Tenders', icon: StackIcon },
  { id: 'runs', label: 'Runs', icon: HistoryIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

// The menu bar still names the old pages.
const MENU_VIEWS: Record<string, View> = { inbox: 'today', tenders: 'tenders', jobs: 'runs', settings: 'settings' };

export function App() {
  const [view, setView] = useState<View>('today');
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeUpdate, setActiveUpdate] = useState<AuthJobUpdate | null>(null);
  const [finishedRun, setFinishedRun] = useState<FinishedRun | null>(null);
  // The dates (jobs) of the search session in progress, and the report once it ends.
  const sessionJobs = useRef<string[]>([]);
  const [report, setReport] = useState<{ jobIds: string[]; message: string | null } | null>(null);
  const [settings, setSettings] = useState<RunSettingsState | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [settingsFocus, setSettingsFocus] = useState<{ section: SettingsSection; requestId: number } | null>(null);
  const [portalId, setPortalIdState] = useState(() => {
    try { return localStorage.getItem('tenderassist.portal') || DEFAULT_PORTAL_ID; } catch { return DEFAULT_PORTAL_ID; }
  });
  const setPortalId = (next: string) => {
    try { localStorage.setItem('tenderassist.portal', next); } catch { /* remembered for this session */ }
    setPortalIdState(next);
  };

  const go = useCallback((next: View) => { setView(next); setOpenRunId(null); }, []);
  // Leaving the report for any page (or Today again) closes it.
  const goFromReport = useCallback((next: View) => { setReport(null); go(next); }, [go]);
  const openSettings = useCallback((section?: SettingsSection) => {
    go('settings');
    setSettingsFocus(section ? { section, requestId: Date.now() } : null);
  }, [go]);

  useEffect(() => {
    window.tenderAssist.getTextSize().then(applyTextSize).catch(console.error);
    window.tenderAssist.getRunSettings().then(setSettings).catch(console.error);
    window.tenderAssist.getInbox().then((inbox) => setWaiting(inbox.attentionCount)).catch(console.error);
  }, []);

  useEffect(() => window.tenderAssist.onAppNavigation((command) => {
    go(MENU_VIEWS[command.view] ?? 'today');
    if (command.view === 'settings' && command.section) setSettingsFocus({ section: command.section, requestId: Date.now() });
  }), [go]);

  // App-level so "a search is running" survives moving between pages.
  useEffect(() => window.tenderAssist.onJobUpdate((update) => {
    const over = update.outcome === 'TIMEOUT' || update.outcome === 'ABORTED' || (update.outcome === 'SUCCESS' && update.phase === 'PUBLISHING');
    if (!sessionJobs.current.includes(update.jobId)) sessionJobs.current = [...sessionJobs.current, update.jobId];
    if (over) {
      // The session ended: show what it did, then start a fresh list for the next one.
      setReport({ jobIds: sessionJobs.current, message: update.statusMessage ?? update.abortReason ?? null });
      sessionJobs.current = [];
      setView('today');
      setOpenRunId(null);
    }
    setActiveJobId(over ? null : update.jobId);
    setActiveUpdate(over ? null : update);
    if (update.outcome === 'SUCCESS' && update.phase === 'PUBLISHING' && update.statusMessage) {
      setFinishedRun({ jobId: update.jobId, message: update.statusMessage });
    } else if (update.outcome === 'ABORTED' && update.abortReason) {
      setFinishedRun({ jobId: update.jobId, message: update.abortReason });
    }
    if (update.outcome) window.tenderAssist.getInbox().then((inbox) => setWaiting(inbox.attentionCount)).catch(console.error);
  }), []);

  // After the last date of one website, search another: this sign-in ends and the other website's run starts.
  const switchPortal = useCallback(async (nextPortalId: string, from: string, to: string, runAgain: boolean) => {
    if (!settings) throw new Error('Settings are still loading.');
    setPortalId(nextPortalId);
    try {
      await window.tenderAssist.switchPortalRun({ searchDate: from, portalId: nextPortalId, ...settings.defaults }, to > from ? to : from, { runAgain });
    } catch (err) {
      setPortalId(portalId);
      throw err;
    }
  }, [settings, portalId]);

  const running = activeJobId !== null;
  const portal = getPortalDefinition(portalId);
  const showWorkspace = running && view === 'today' && !openRunId;

  return (
    <div className={showWorkspace ? 'app app--running' : 'app'}>
      <aside className="bar">
        <span className="bar__brand"><BrandMark /> <span className="bar__name">TenderAssist</span></span>
        <nav className="bar__nav" aria-label="Main">
          {NAV.map((item) => (
            <button key={item.id} type="button" className="bar__tab" aria-current={view === item.id ? 'page' : undefined} onClick={() => goFromReport(item.id)} title={item.label}>
              <item.icon />
              <span className="bar__label">{item.label}</span>
              {item.id === 'today' && waiting > 0 && <span className="count count--bar" aria-label={`${waiting} waiting for a decision`}>{waiting}</span>}
              {item.id === 'settings' && settings && !settings.configured && <span className="bar__dot" aria-label="Needs setting up" />}
            </button>
          ))}
        </nav>
        <button type="button" className="bar__tab bar__more" title="Back up, restore, export, about"
          onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); void window.tenderAssist.showAppMenu(box.right + 4, box.top); }}>
          <MoreIcon />
          <span className="bar__label">More</span>
        </button>
        {showWorkspace && (
          <span className="bar__running">
            <span className="bar__pulse" aria-hidden="true" />
            <span className="bar__label">Search running</span>
          </span>
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <span className="topbar__next">
            {showWorkspace ? <>Searching <strong>{portal.name}</strong></>
              : settings && !settings.configured ? <>Next: <button type="button" className="topbar__link" onClick={() => openSettings('relevance')}>tell TenderAssist what to look for</button></>
                : waiting > 0 ? <>Next: <button type="button" className="topbar__link" onClick={() => goFromReport('today')}>decide {waiting} {waiting === 1 ? 'tender' : 'tenders'}</button></>
                  : <>Next: <button type="button" className="topbar__link" onClick={() => goFromReport('today')}>find today’s tenders</button></>}
          </span>
          {running && !showWorkspace && (
            <button type="button" className="topbar__chip" onClick={() => go('today')}>
              <span className="bar__pulse" aria-hidden="true" /> Search running · show
            </button>
          )}
        </header>
        {showWorkspace && activeJobId && isGemPortal(portal) ? (
          // GeM is read without a portal window, so the run panel stands alone.
          <div className="workspace workspace--alone">
            <RunPanel jobId={activeJobId} portalId={portal.id} portalName={portal.name} onSwitchPortal={switchPortal} update={activeUpdate} noSignIn />
          </div>
        ) : showWorkspace && activeJobId ? (
          <RunWorkspace
            portalId={portal.id}
            portalName={portal.name}
            update={activeUpdate}
            guide={<RunPanel jobId={activeJobId} portalId={portal.id} portalName={portal.name} onSwitchPortal={switchPortal} update={activeUpdate} />}
          />
        ) : openRunId ? (
          <RunDetail jobId={openRunId} isActive={openRunId === activeJobId} onBack={() => setOpenRunId(null)} onOpenSettings={openSettings} />
        ) : view === 'today' && report && !running ? (
          <SessionReport
            jobIds={report.jobIds}
            message={report.message}
            onDecide={() => { setReport(null); setFinishedRun(null); }}
            onOpenRun={(jobId) => setOpenRunId(jobId)}
          />
        ) : view === 'today' ? (
          <TodayPage
            settings={settings}
            selectedPortalId={portalId}
            onPortalChange={setPortalId}
            onOpenSettings={openSettings}
            onRunStarted={(jobId) => { sessionJobs.current = [jobId]; setActiveJobId(jobId); setFinishedRun(null); setReport(null); }}
            onOpenRun={(jobId) => setOpenRunId(jobId)}
            onInboxCount={setWaiting}
            finishedRun={finishedRun}
            onDismissFinished={() => setFinishedRun(null)}
          />
        ) : view === 'tenders' ? (
          <TendersPage onInboxCount={setWaiting} />
        ) : view === 'runs' ? (
          <RunsPage activeJobId={activeJobId} onOpenRun={setOpenRunId} />
        ) : (
          <SettingsPage settings={settings} onSaved={setSettings} selectedPortalId={portalId} onPortalChange={setPortalId} focusRequest={settingsFocus} />
        )}
      </main>
    </div>
  );
}
