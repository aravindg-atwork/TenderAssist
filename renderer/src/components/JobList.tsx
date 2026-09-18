// renderer/src/components/JobList.tsx
import { useEffect, useState } from 'react';
import type { JobListItem } from '../../../src/electron/ipcTypes';

export interface JobListProps {
  onSelectJob: (jobId: string) => void;
}

export function JobList({ onSelectJob }: JobListProps) {
  const [jobs, setJobs] = useState<JobListItem[]>([]);

  useEffect(() => {
    window.tenderAssist.listJobs().then(setJobs);
  }, []);

  return (
    <div>
      <h1>Jobs</h1>
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
