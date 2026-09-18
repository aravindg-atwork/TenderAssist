// renderer/src/App.tsx
import { useState } from 'react';
import { JobList } from './components/JobList';
import { JobDetail } from './components/JobDetail';

export function App() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  if (selectedJobId) {
    return <JobDetail jobId={selectedJobId} onBack={() => setSelectedJobId(null)} />;
  }
  return <JobList onSelectJob={setSelectedJobId} />;
}
