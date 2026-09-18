// renderer/src/components/JobDetail.tsx
import { useEffect, useState } from 'react';
import type { JobDetail as JobDetailData } from '../../../src/electron/ipcTypes';

export interface JobDetailProps {
  jobId: string;
  onBack: () => void;
}

export function JobDetail({ jobId, onBack }: JobDetailProps) {
  const [detail, setDetail] = useState<JobDetailData | null>(null);

  useEffect(() => {
    window.tenderAssist.getJobDetail(jobId).then(setDetail);
  }, [jobId]);

  if (!detail) return <p>Loading...</p>;

  return (
    <div>
      <button onClick={onBack}>&larr; Back to jobs</button>
      <h1>Job {detail.jobId.slice(0, 8)}</h1>
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
