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

  useEffect(() => {
    window.tenderAssist.getJobDetail(jobId).then(setDetail);
  }, [jobId]);

  useEffect(() => {
    const unsubscribe = window.tenderAssist.onJobUpdate((update) => {
      if (update.jobId !== jobId) return;
      setLatestUpdate(update);
      window.tenderAssist.getJobDetail(jobId).then(setDetail);
    });
    return unsubscribe;
  }, [jobId]);

  if (!detail) return <p>Loading...</p>;

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
