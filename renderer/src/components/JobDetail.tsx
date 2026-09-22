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
        {detail.runConfiguration && (
          <div className="detail-meta__item">
            <span className="detail-meta__label">Published date</span>
            <span>{detail.runConfiguration.searchDate}</span>
          </div>
        )}
      </div>

      {detail.runConfiguration && (
        <details className="run-config-summary">
          <summary>Run intent and categories</summary>
          <div className="run-config-summary__grid">
            <div>
              <h3>Product categories</h3>
              <p>{detail.runConfiguration.productCategories.join(', ')}</p>
            </div>
            <div>
              <h3>Intent keywords</h3>
              <p>{detail.runConfiguration.keywords.join(', ')}</p>
            </div>
            <div>
              <h3>Excluded scope</h3>
              <p>{detail.runConfiguration.excludedKeywords.join(', ') || 'None'}</p>
            </div>
          </div>
        </details>
      )}

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

      {detail.tenders.length > 0 && (
        <div>
          <h2>Tenders found ({detail.tenders.length})</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tender ID</th>
                <th>Title</th>
                <th>Category</th>
                <th>Value (₹)</th>
                <th>Favorited</th>
                <th>Detail reviewed</th>
                <th>Intent decision</th>
              </tr>
            </thead>
            <tbody>
              {detail.tenders.map((t) => (
                <tr key={t.id}>
                  <td className="job-id">{t.tender_portal_id ?? t.tender_ref}</td>
                  <td>{t.title}</td>
                  <td>{t.product_category}</td>
                  <td>{t.value_in_rupees}</td>
                  <td>{t.favorited ? 'Yes' : 'No'}</td>
                  <td>{t.detail_reviewed_at ? 'Yes' : 'No'}</td>
                  <td><StatePill state={t.classification} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
