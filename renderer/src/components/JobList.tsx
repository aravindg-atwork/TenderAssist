// renderer/src/components/JobList.tsx
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import type { JobListItem } from '../../../src/electron/ipcTypes';
import { StatePill } from './StatePill';
import { TrashIcon } from './icons';

export interface JobListProps {
  onSelectJob: (jobId: string) => void;
  activeJobId: string | null;
  onActiveJobChange: (jobId: string | null) => void;
}

const todayIso = (): string => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export function JobList({ onSelectJob, activeJobId, onActiveJobChange }: JobListProps) {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchDate, setSearchDate] = useState(todayIso);

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
      const { jobId } = await window.tenderAssist.startJob(searchDate);
      onActiveJobChange(jobId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleDelete = async (event: MouseEvent, jobId: string) => {
    event.stopPropagation();
    if (!window.confirm('Delete this job and its history? This cannot be undone.')) return;
    setError(null);
    try {
      await window.tenderAssist.deleteJob(jobId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div className="list-header">
        <h1>Jobs</h1>
        <div className="start-job-controls">
          <label className="start-job-controls__date">
            Published on
            <input
              type="date"
              value={searchDate}
              max={todayIso()}
              disabled={starting || activeJobId !== null}
              onChange={(event) => setSearchDate(event.target.value)}
            />
          </label>
          <button className="btn btn-primary" onClick={handleStart} disabled={starting || activeJobId !== null}>
            {activeJobId ? 'Job running…' : 'Start new job'}
          </button>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {jobs.length === 0 ? (
        <div className="data-table">
          <p className="empty-state">No jobs yet. Start one to begin.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Job state</th>
              <th>Auth state</th>
              <th>Created</th>
              <th>Updated</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.jobId} onClick={() => onSelectJob(job.jobId)}>
                <td className="job-id">{job.jobId.slice(0, 8)}</td>
                <td>
                  <StatePill state={job.jobState} />
                </td>
                <td>
                  <StatePill state={job.authState} />
                </td>
                <td>{job.createdAt}</td>
                <td>{job.updatedAt}</td>
                <td className="col-actions">
                  {job.jobId !== activeJobId && (
                    <button
                      className="icon-btn icon-btn-danger"
                      title="Delete job"
                      aria-label="Delete job"
                      onClick={(event) => handleDelete(event, job.jobId)}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
