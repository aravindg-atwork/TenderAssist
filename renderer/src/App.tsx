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
      setActiveJobId(update.outcome ? null : update.jobId);
    });
    return unsubscribe;
  }, []);

  if (selectedJobId) {
    return <JobDetail jobId={selectedJobId} onBack={() => setSelectedJobId(null)} />;
  }
  return (
    <JobList
      onSelectJob={setSelectedJobId}
      activeJobId={activeJobId}
      onActiveJobChange={setActiveJobId}
    />
  );
}
