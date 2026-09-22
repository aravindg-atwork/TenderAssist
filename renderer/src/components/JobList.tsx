// renderer/src/components/JobList.tsx
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { JobListItem } from '../../../src/electron/ipcTypes';
import type { RunConfiguration, RunDefaults } from '../../../src/config/runConfiguration';
import { StatePill } from './StatePill';
import { TrashIcon } from './icons';
import { RunSetupDialog } from './RunSetupDialog';

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
  const [runDefaults, setRunDefaults] = useState<RunDefaults | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const startButtonRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    window.tenderAssist
      .listJobs()
      .then(setJobs)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
    window.tenderAssist
      .getRunDefaults()
      .then(setRunDefaults)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    const unsubscribe = window.tenderAssist.onJobUpdate((update) => {
      if (update.outcome) refresh();
    });
    return unsubscribe;
  }, [refresh]);

  const handleStart = async (config: RunConfiguration) => {
    setStarting(true);
    setError(null);
    try {
      const { jobId } = await window.tenderAssist.startJob(config);
      onActiveJobChange(jobId);
      setSetupOpen(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const closeSetup = () => {
    setSetupOpen(false);
    requestAnimationFrame(() => startButtonRef.current?.focus());
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
        <button
          ref={startButtonRef}
          className="btn btn-primary"
          onClick={() => setSetupOpen(true)}
          disabled={starting || activeJobId !== null || !runDefaults}
        >
          {activeJobId ? 'Job running…' : 'Start new job'}
        </button>
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
      {setupOpen && runDefaults && (
        <RunSetupDialog
          defaults={runDefaults}
          today={todayIso()}
          submitting={starting}
          onCancel={closeSetup}
          onSubmit={handleStart}
        />
      )}
    </div>
  );
}
