// renderer/src/App.tsx
import { useCallback, useEffect, useState } from 'react';
import type { AuthJobUpdate, RunSettingsState, SettingsSection } from '../../src/electron/ipcTypes';
import { DEFAULT_PORTAL_ID, getPortalDefinition } from '../../src/config/portalRegistry';
import { applyTextSize } from './display';
import { TodayPage, type FinishedRun } from './components/TodayPage';
import { TendersPage } from './components/TendersPage';
import { RunsPage } from './components/RunsPage';
import { RunDetail } from './components/RunDetail';
import { SettingsPage } from './components/SettingsPage';
import { RunWorkspace } from './components/RunWorkspace';
import { RunPanel } from './components/RunPanel';
import { BrandMark } from './components/icons';

type View = 'today' | 'tenders' | 'runs' | 'settings';

const NAV: Array<{ id: View; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'tenders', label: 'Tenders' },
  { id: 'runs', label: 'Runs' },
  { id: 'settings', label: 'Settings' },
];

// The menu bar still names the old pages.
const MENU_VIEWS: Record<string, View> = { inbox: 'today', tenders: 'tenders', jobs: 'runs', settings: 'settings' };

export function App() {
  const [view, setView] = useState<View>('today');
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeUpdate, setActiveUpdate] = useState<AuthJobUpdate | null>(null);
  const [finishedRun, setFinishedRun] = useState<FinishedRun | null>(null);
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
    setActiveJobId(over ? null : update.jobId);
    setActiveUpdate(over ? null : update);
    if (update.outcome === 'SUCCESS' && update.phase === 'PUBLISHING' && update.statusMessage) {
      setFinishedRun({ jobId: update.jobId, message: update.statusMessage });
    } else if (update.outcome === 'ABORTED' && update.abortReason) {
      setFinishedRun({ jobId: update.jobId, message: update.abortReason });
    }
    if (update.outcome) window.tenderAssist.getInbox().then((inbox) => setWaiting(inbox.attentionCount)).catch(console.error);
  }), []);

  const running = activeJobId !== null;
  const portal = getPortalDefinition(portalId);
  const showWorkspace = running && view === 'today' && !openRunId;

  return (
    <div className={showWorkspace ? 'app app--running' : 'app'}>
      <header className="bar">
        <span className="bar__brand"><BrandMark /> TenderAssist</span>
        <nav className="bar__nav" aria-label="Main">
          {NAV.map((item) => (
            <button key={item.id} type="button" className="bar__tab" aria-current={view === item.id ? 'page' : undefined} onClick={() => go(item.id)}>
              {item.label}
              {item.id === 'today' && waiting > 0 && <span className="count count--bar" aria-label={`${waiting} waiting for a decision`}>{waiting}</span>}
              {item.id === 'settings' && settings && !settings.configured && <span className="bar__dot" aria-label="Needs setting up" />}
            </button>
          ))}
        </nav>
        {running && !showWorkspace && (
          <button type="button" className="bar__running" onClick={() => go('today')}>
            <span className="bar__pulse" aria-hidden="true" /> Search running · show
          </button>
        )}
      </header>

      <main className="main">
        {showWorkspace && activeJobId ? (
          <RunWorkspace
            portalId={portal.id}
            portalName={portal.name}
            update={activeUpdate}
            guide={<RunPanel jobId={activeJobId} portalName={portal.name} update={activeUpdate} />}
          />
        ) : openRunId ? (
          <RunDetail jobId={openRunId} isActive={openRunId === activeJobId} onBack={() => setOpenRunId(null)} onOpenSettings={openSettings} />
        ) : view === 'today' ? (
          <TodayPage
            settings={settings}
            selectedPortalId={portalId}
            onPortalChange={setPortalId}
            onOpenSettings={openSettings}
            onRunStarted={(jobId) => { setActiveJobId(jobId); setFinishedRun(null); }}
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
