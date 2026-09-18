// renderer/src/components/JobList.tsx
import { useCallback, useEffect, useState } from 'react';
import type { JobListItem } from '../../../src/electron/ipcTypes';

export interface JobListProps {
  onSelectJob: (jobId: string) => void;
  activeJobId: string | null;
  onActiveJobChange: (jobId: string | null) => void;
}

export function JobList({ onSelectJob, activeJobId, onActiveJobChange }: JobListProps) {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    window.tenderAssist
      .listJobs()
      .then(setJobs)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = window.tenderAssist.onJobUpdate((update) => {
      if (update.outcome) refresh();
    });
    return unsubscribe;
  }, [refresh]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const { jobId } = await window.tenderAssist.startJob();
      onActiveJobChange(jobId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div>
      <h1>Jobs</h1>
      <button onClick={handleStart} disabled={starting || activeJobId !== null}>
        {activeJobId ? 'Job running…' : 'Start new job'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Job State</th>
            <th>Auth State</th>
            <th>Created</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.jobId} onClick={() => onSelectJob(job.jobId)} style={{ cursor: 'pointer' }}>
              <td>{job.jobId.slice(0, 8)}</td>
              <td>{job.jobState}</td>
              <td>{job.authState ?? '—'}</td>
              <td>{job.createdAt}</td>
              <td>{job.updatedAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
