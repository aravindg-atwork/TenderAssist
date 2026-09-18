// renderer/src/components/JobDetail.tsx
import { useEffect, useState } from 'react';
import type { AuthJobUpdate, JobDetail as JobDetailData } from '../../../src/electron/ipcTypes';

export interface JobDetailProps {
  jobId: string;
  onBack: () => void;
}

export function JobDetail({ jobId, onBack }: JobDetailProps) {
  const [detail, setDetail] = useState<JobDetailData | null>(null);
  const [latestUpdate, setLatestUpdate] = useState<AuthJobUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.tenderAssist
      .getJobDetail(jobId)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [jobId]);

  useEffect(() => {
    const unsubscribe = window.tenderAssist.onJobUpdate((update) => {
      if (update.jobId !== jobId) return;
      setLatestUpdate(update);
      window.tenderAssist
        .getJobDetail(jobId)
        .then((d) => {
          setDetail(d);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    });
    return unsubscribe;
  }, [jobId]);

  // The Back button must stay reachable in every state -- loading, error,
  // and loaded -- so an IPC failure never strands the user on this screen.
  if (error) {
    return (
      <div>
        <button onClick={onBack}>&larr; Back to jobs</button>
        <p style={{ color: 'red' }}>Failed to load job: {error}</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div>
        <button onClick={onBack}>&larr; Back to jobs</button>
        <p>Loading...</p>
      </div>
    );
  }

  const bannerColor =
    latestUpdate?.outcome === 'SUCCESS' ? 'green' : latestUpdate?.outcome === 'ABORTED' ? 'red' : 'gray';

  return (
    <div>
      <button onClick={onBack}>&larr; Back to jobs</button>
      <h1>Job {detail.jobId.slice(0, 8)}</h1>
      {latestUpdate?.outcome && (
        <p style={{ color: bannerColor, fontWeight: 'bold' }}>
          {latestUpdate.outcome}
          {latestUpdate.abortReason ? `: ${latestUpdate.abortReason}` : ''}
        </p>
      )}
      <p>
        Job state: <strong>{detail.jobState}</strong>
      </p>
      <p>
        Auth state: <strong>{detail.authState ?? '—'}</strong>
      </p>

      <h2>Job transitions</h2>
      <ul>
        {detail.jobTransitions.map((t) => (
          <li key={t.id}>
            {t.from_state ?? '(start)'} &rarr; {t.to_state} — {t.reason ?? ''} ({t.occurred_at})
          </li>
        ))}
      </ul>

      <h2>Auth session transitions</h2>
      <ul>
        {detail.authTransitions.map((t) => (
          <li key={t.id}>
            {t.from_state ?? '(start)'} &rarr; {t.to_state} — {t.reason ?? ''} ({t.occurred_at})
          </li>
        ))}
      </ul>
    </div>
  );
}
