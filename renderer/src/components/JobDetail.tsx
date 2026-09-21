// renderer/src/components/JobDetail.tsx
import { useEffect, useState } from 'react';
import type { AuthJobUpdate, JobDetail as JobDetailData } from '../../../src/electron/ipcTypes';
import { StatePill } from './StatePill';

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
        <button className="btn-link detail-back" onClick={onBack}>
          &larr; Jobs
        </button>
        <p className="error-text">Failed to load job: {error}</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div>
        <button className="btn-link detail-back" onClick={onBack}>
          &larr; Jobs
        </button>
        <p>Loading...</p>
      </div>
    );
  }

  const bannerClass =
    latestUpdate?.outcome === 'SUCCESS'
      ? 'banner banner-success'
      : latestUpdate?.outcome === 'ABORTED'
        ? 'banner banner-error'
        : 'banner';

  return (
    <div>
      <button className="btn-link detail-back" onClick={onBack}>
        &larr; Jobs
      </button>
      <div className="detail-header">
        <h1>Job {detail.jobId.slice(0, 8)}</h1>
      </div>

      {latestUpdate?.outcome && (
        <div className={bannerClass}>
          <span className="banner__outcome">{latestUpdate.outcome}</span>
          {latestUpdate.abortReason && <span>{latestUpdate.abortReason}</span>}
        </div>
      )}

      <div className="detail-meta">
        <div className="detail-meta__item">
          <span className="detail-meta__label">Job state</span>
          <StatePill state={detail.jobState} />
        </div>
        <div className="detail-meta__item">
          <span className="detail-meta__label">Auth state</span>
          <StatePill state={detail.authState} />
        </div>
      </div>

      <div className="detail-columns">
        <div>
          <h2>Job transitions</h2>
          {detail.jobTransitions.length === 0 ? (
            <p className="timeline-empty">No transitions yet.</p>
          ) : (
            <ul className="timeline">
              {detail.jobTransitions.map((t) => (
                <li key={t.id}>
                  <div className="timeline__transition">
                    {t.from_state ?? '(start)'} &rarr; {t.to_state}
                  </div>
                  {t.reason && <div className="timeline__reason">{t.reason}</div>}
                  <div className="timeline__time">{t.occurred_at}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2>Auth session transitions</h2>
          {detail.authTransitions.length === 0 ? (
            <p className="timeline-empty">No transitions yet.</p>
          ) : (
            <ul className="timeline">
              {detail.authTransitions.map((t) => (
                <li key={t.id}>
                  <div className="timeline__transition">
                    {t.from_state ?? '(start)'} &rarr; {t.to_state}
                  </div>
                  {t.reason && <div className="timeline__reason">{t.reason}</div>}
                  <div className="timeline__time">{t.occurred_at}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
