// renderer/src/App.tsx
import { useEffect, useState } from 'react';
import { JobList } from './components/JobList';
import { JobDetail } from './components/JobDetail';
import { SettingsPage } from './components/SettingsPage';
import type { AuthJobUpdate, RunSettingsState } from '../../src/electron/ipcTypes';
import { DEFAULT_PORTAL_ID } from '../../src/config/portalRegistry';

type AppView = 'jobs' | 'settings';

export function App() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobUpdate, setActiveJobUpdate] = useState<AuthJobUpdate | null>(null);
  const [view, setView] = useState<AppView>('jobs');
  const [settings, setSettings] = useState<RunSettingsState | null>(null);
  const [selectedPortalId, setSelectedPortalIdState] = useState(() => localStorage.getItem('tenderassist.portal') || DEFAULT_PORTAL_ID);
  const setSelectedPortalId = (portalId: string) => {
    localStorage.setItem('tenderassist.portal', portalId);
    setSelectedPortalIdState(portalId);
  };

  useEffect(() => {
    window.tenderAssist.getRunSettings().then(setSettings).catch(console.error);
  }, []);

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
    });
    return unsubscribe;
  }, []);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <button
          className="app-topbar__brand"
          onClick={() => { setView('jobs'); setSelectedJobId(null); }}
        >
          <span className="brand-mark" aria-hidden="true">T</span>
          <span className="app-topbar__title">TenderAssist</span>
        </button>
        <nav className="app-nav" aria-label="Main navigation">
          <button
            className={view === 'jobs' ? 'app-nav__item is-active' : 'app-nav__item'}
            onClick={() => { setView('jobs'); setSelectedJobId(null); }}
          >
            Jobs
          </button>
          <button
            className={view === 'settings' ? 'app-nav__item is-active' : 'app-nav__item'}
            onClick={() => { setView('settings'); setSelectedJobId(null); }}
          >
            Settings
            {settings && !settings.configured && <span className="nav-dot" aria-label="Setup required" />}
          </button>
        </nav>
      </header>
      <main className={activeJobId && view === 'jobs' && !selectedJobId ? 'app-main app-main--portal' : 'app-main'}>
        {view === 'settings' ? (
          <SettingsPage settings={settings} onSaved={setSettings} selectedPortalId={selectedPortalId} onPortalChange={setSelectedPortalId} />
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
