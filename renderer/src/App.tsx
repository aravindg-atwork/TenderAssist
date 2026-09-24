// renderer/src/App.tsx
import { useEffect, useState } from 'react';
import { JobList } from './components/JobList';
import { JobDetail } from './components/JobDetail';
import { SettingsPage } from './components/SettingsPage';
import { Inbox } from './components/Inbox';
import { TendersPage } from './components/TendersPage';
import type { AuthJobUpdate, RunSettingsState } from '../../src/electron/ipcTypes';
import { DEFAULT_PORTAL_ID } from '../../src/config/portalRegistry';

type AppView = 'inbox' | 'tenders' | 'jobs' | 'settings';

export function App() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobUpdate, setActiveJobUpdate] = useState<AuthJobUpdate | null>(null);
  const [view, setView] = useState<AppView>('jobs');
  const [settingsFocus, setSettingsFocus] = useState<{ section: 'folders'; requestId: number } | null>(null);
  const [settings, setSettings] = useState<RunSettingsState | null>(null);
  const [inboxCount, setInboxCount] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const navigate = (next: AppView) => { setNavigated(true); setView(next); setSelectedJobId(null); };
  const [selectedPortalId, setSelectedPortalIdState] = useState(() => localStorage.getItem('tenderassist.portal') || DEFAULT_PORTAL_ID);
  const setSelectedPortalId = (portalId: string) => {
    localStorage.setItem('tenderassist.portal', portalId);
    setSelectedPortalIdState(portalId);
  };

  useEffect(() => {
    window.tenderAssist.getRunSettings().then(setSettings).catch(console.error);
    window.tenderAssist.getInbox().then((inbox) => setInboxCount(inbox.attentionCount)).catch(console.error);
  }, []);

  // Open on the Inbox when something needs a decision, unless the operator
  // has already moved elsewhere.
  useEffect(() => {
    if (!navigated && inboxCount > 0 && view === 'jobs' && !activeJobId) setView('inbox');
  }, [navigated, inboxCount, view, activeJobId]);

  useEffect(() => window.tenderAssist.onAppNavigation((command) => {
    setNavigated(true);
    setView(command.view);
    setSelectedJobId(null);
    if (command.view === 'settings' && command.section) {
      setSettingsFocus({ section: command.section, requestId: Date.now() });
    } else {
      setSettingsFocus(null);
    }
  }), []);

  useEffect(() => {
    // Lives at the App level (never unmounts) rather than inside JobList, so
    // "is a job currently running" survives navigating to Job Detail and
    // back -- JobList itself unmounts/remounts on that navigation, which
    // previously reset this state and let the button re-enable mid-run.
    const unsubscribe = window.tenderAssist.onJobUpdate((update) => {
      // The auth phase's own SUCCESS is no longer the end of the run -- the
      // search phase continues automatically on the same job. Only treat
      // the run as over on a genuine failure (any phase), or the
      // classification phase's own terminal SUCCESS.
      const runOver =
        update.outcome === 'TIMEOUT' ||
        update.outcome === 'ABORTED' ||
        (update.outcome === 'SUCCESS' && update.phase === 'PUBLISHING');
      setActiveJobId(runOver ? null : update.jobId);
      setActiveJobUpdate(runOver ? null : update);
      if (update.outcome) {
        window.tenderAssist.getInbox().then((inbox) => setInboxCount(inbox.attentionCount)).catch(console.error);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <button
          className="app-topbar__brand"
          onClick={() => navigate('inbox')}
        >
          <span className="brand-mark" aria-hidden="true">T</span>
          <span className="app-topbar__title">TenderAssist</span>
        </button>
        <nav className="app-nav" aria-label="Main navigation">
          <button
            className={view === 'inbox' ? 'app-nav__item is-active' : 'app-nav__item'}
            aria-current={view === 'inbox' ? 'page' : undefined}
            onClick={() => navigate('inbox')}
          >
            Inbox
            {inboxCount > 0 && <span className="nav-count" aria-label={`${inboxCount} need a decision`}>{inboxCount}</span>}
          </button>
          <button
            className={view === 'tenders' ? 'app-nav__item is-active' : 'app-nav__item'}
            aria-current={view === 'tenders' ? 'page' : undefined}
            onClick={() => navigate('tenders')}
          >
            Tenders
          </button>
          <button
            className={view === 'jobs' ? 'app-nav__item is-active' : 'app-nav__item'}
            aria-current={view === 'jobs' ? 'page' : undefined}
            onClick={() => navigate('jobs')}
          >
            Runs
          </button>
          <button
            className={view === 'settings' ? 'app-nav__item is-active' : 'app-nav__item'}
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => navigate('settings')}
          >
            Settings
            {settings && !settings.configured && <span className="nav-dot" aria-label="Setup required" />}
          </button>
        </nav>
      </header>
      <main className={activeJobId && view === 'jobs' && !selectedJobId ? 'app-main app-main--portal' : 'app-main'}>
        {view === 'inbox' ? (
          <Inbox onStartDiscovery={() => navigate('jobs')} onCountChange={setInboxCount} />
        ) : view === 'tenders' ? (
          <TendersPage onInboxChange={setInboxCount} />
        ) : view === 'settings' ? (
          <SettingsPage settings={settings} onSaved={setSettings} selectedPortalId={selectedPortalId} onPortalChange={setSelectedPortalId} focusRequest={settingsFocus} />
        ) : selectedJobId ? (
          <JobDetail jobId={selectedJobId} onBack={() => setSelectedJobId(null)} />
        ) : (
          <JobList
            onSelectJob={setSelectedJobId}
            activeJobId={activeJobId}
            activeJobUpdate={activeJobUpdate}
            onActiveJobChange={setActiveJobId}
            settings={settings}
            onOpenSettings={() => setView('settings')}
            selectedPortalId={selectedPortalId}
            onPortalChange={setSelectedPortalId}
          />
        )}
      </main>
    </div>
  );
}
