import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import type { JobListItem } from '../../../src/electron/ipcTypes';
import { getPortalDefinition } from '../../../src/config/portalRegistry';
import { relativeTime, absoluteDateTime } from '../format';
import { plainError, plural, publishedLabel, runStatus } from '../words';
import { TrashIcon } from './icons';

export interface RunsPageProps {
  activeJobId: string | null;
  onOpenRun: (jobId: string) => void;
}

/** Every search TenderAssist has run, newest first, in plain words. */
const runName = (run: JobListItem) => run.purpose === 'DOCUMENTS' ? 'the documents run' : `the search for ${publishedLabel(run.searchDate)}`;

export function RunsPage({ activeJobId, onOpenRun }: RunsPageProps) {
  const [runs, setRuns] = useState<JobListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    window.tenderAssist.listJobs().then(setRuns).catch((err) => setError(plainError(err)));
  }, []);
  useEffect(() => {
    load();
    return window.tenderAssist.onJobUpdate((update) => { if (update.outcome) load(); });
  }, [load]);

  const remove = async (event: MouseEvent, run: JobListItem) => {
    event.stopPropagation();
    if (!window.confirm(`Delete the record of ${runName(run)}? Tenders and files are kept.`)) return;
    try { await window.tenderAssist.deleteJob(run.jobId); load(); }
    catch (err) { setError(plainError(err)); }
  };

  return (
    <div className="page">
      <header className="page__head">
        <h1>Runs</h1>
        <p>Every search, newest first. Open one to see what was checked and why.</p>
      </header>
      {error && <p className="notice notice--stop" role="alert">{error}</p>}
      {runs && runs.length === 0 && <p className="page__empty">No searches yet. Start one from Today.</p>}
      {runs && runs.length > 0 && (
        <table className="ledger">
          <thead>
            <tr><th scope="col">Published date</th><th scope="col">Result</th><th scope="col" className="num">Found</th><th scope="col" className="num">Kept</th><th scope="col">Website</th><th scope="col">Searched</th><th scope="col"><span className="visually-hidden">Delete</span></th></tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const status = runStatus(run.jobState, run.jobId === activeJobId);
              return (
                <tr key={run.jobId} onClick={() => onOpenRun(run.jobId)} tabIndex={0}
                  onKeyDown={(event) => { if (event.key === 'Enter') onOpenRun(run.jobId); }}>
                  <td className="ledger__strong">{run.purpose === 'DOCUMENTS' ? 'Documents for approved tenders' : publishedLabel(run.searchDate)}</td>
                  <td><span className={`status status--${status.tone}`}>{status.text}</span></td>
                  <td className="num">{run.tendersFound}</td>
                  <td className="num">{run.kept > 0 ? <strong>{run.kept}</strong> : '0'}</td>
                  <td>{getPortalDefinition(run.portalId).name}</td>
                  <td title={absoluteDateTime(run.createdAt)}>{relativeTime(run.createdAt)}</td>
                  <td className="ledger__action">
                    {run.jobId !== activeJobId && (
                      <button type="button" className="btn btn--icon" aria-label={`Delete the record of ${runName(run)}`} onClick={(event) => remove(event, run)}>
                        <TrashIcon />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={7}>{plural(runs.length, 'search', 'searches')}</td></tr></tfoot>
        </table>
      )}
      {!runs && !error && <p className="page__empty">Loading…</p>}
    </div>
  );
}
