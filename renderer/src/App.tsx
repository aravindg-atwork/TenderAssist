// renderer/src/App.tsx
import { useEffect, useState } from 'react';
import { JobList } from './components/JobList';
import { JobDetail } from './components/JobDetail';

export function App() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

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
        (update.outcome === 'SUCCESS' && update.phase === 'CLASSIFICATION');
      setActiveJobId(runOver ? null : update.jobId);
    });
    return unsubscribe;
  }, []);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <span className="app-topbar__title">TenderAssist</span>
      </header>
      <main className="app-main">
        {selectedJobId ? (
          <JobDetail jobId={selectedJobId} onBack={() => setSelectedJobId(null)} />
        ) : (
          <JobList
            onSelectJob={setSelectedJobId}
            activeJobId={activeJobId}
            onActiveJobChange={setActiveJobId}
          />
        )}
      </main>
    </div>
  );
}
