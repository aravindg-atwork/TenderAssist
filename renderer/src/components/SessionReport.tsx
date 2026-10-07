import { useEffect, useState } from 'react';
import type { JobDetail } from '../../../src/electron/ipcTypes';
import { plainError, plural, publishedLabel, runStatus } from '../words';
import { AlertIcon, ArrowRightIcon } from './icons';

export interface SessionReportProps {
  jobIds: string[];
  /** How the session ended, in the run's own words. */
  message: string | null;
  onDecide: () => void;
  onOpenRun: (jobId: string) => void;
}

interface DateLine {
  detail: JobDetail;
  found: number;
  kept: number;
  rejected: number;
  look: number;
  saved: number;
}

function lineFor(detail: JobDetail): DateLine {
  const count = (decision: string) => detail.tenders.filter((tender) => tender.effectiveClassification === decision).length;
  return {
    detail,
    found: detail.tenders.length,
    kept: count('KEEP'),
    rejected: count('REJECT'),
    look: count('UNCERTAIN'),
    saved: detail.tenders.reduce((sum, tender) => sum + tender.documents.filter((document) => document.state === 'DOWNLOADED').length, 0),
  };
}

/** What a search session did, date by date, and what is now waiting. */
export function SessionReport({ jobIds, message, onDecide, onOpenRun }: SessionReportProps) {
  const [lines, setLines] = useState<DateLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all(jobIds.map((jobId) => window.tenderAssist.getJobDetail(jobId).catch(() => null)))
      .then((details) => {
        if (!current) return;
        // A date restarted after a sign-in problem appears once, as its last attempt.
        const byDate = new Map<string, DateLine>();
        for (const detail of details) {
          if (!detail) continue;
          byDate.set(detail.runConfiguration?.searchDate ?? detail.jobId, lineFor(detail));
        }
        setLines([...byDate.values()].sort((a, b) => (a.detail.runConfiguration?.searchDate ?? '').localeCompare(b.detail.runConfiguration?.searchDate ?? '')));
      })
      .catch((err) => setError(plainError(err)));
    return () => { current = false; };
  }, [jobIds]);

  if (error) return <div className="page"><p className="notice notice--stop" role="alert">{error}</p></div>;
  if (!lines) return <div className="page"><p className="page__empty">Putting the report together…</p></div>;

  const total = (key: keyof Omit<DateLine, 'detail'>) => lines.reduce((sum, line) => sum + line[key], 0);
  const keptTenders = lines.flatMap((line) => line.detail.tenders
    .filter((tender) => tender.effectiveClassification === 'KEEP')
    .map((tender) => ({ tender, date: line.detail.runConfiguration?.searchDate ?? null })));
  const problems = lines.flatMap((line) => [
    ...line.detail.searches.filter((search) => search.state === 'FAILED')
      .map((search) => `${publishedLabel(line.detail.runConfiguration?.searchDate ?? null)}: ${search.product_category} could not be searched.`),
    ...(line.detail.jobState !== 'COMPLETE' ? [`${publishedLabel(line.detail.runConfiguration?.searchDate ?? null)}: ${runStatus(line.detail.jobState, false).text.toLowerCase()}.`] : []),
  ]);
  // Waiting means not yet decided: a tender answered during the run, or decided
  // before, is not counted again, and one tender found on two dates counts once.
  const undecided = new Set(lines.flatMap((line) => line.detail.tenders
    .filter((tender) => (tender.effectiveClassification === 'KEEP' || tender.effectiveClassification === 'UNCERTAIN')
      && (tender.opportunityLifecycle === null || tender.opportunityLifecycle === 'NEW' || tender.opportunityLifecycle === 'SCREENED'))
    .map((tender) => tender.opportunity_id ?? tender.id)));
  const waiting = undecided.size;
  const documentRun = lines.length > 0 && lines.every((line) => line.detail.purpose === 'DOCUMENTS');
  if (documentRun) {
    const collected = lines.flatMap((line) => line.detail.tenders);
    const withFiles = collected.filter((tender) => tender.documents.some((document) => document.state === 'DOWNLOADED'));
    return (
      <div className="page report">
        <header className="page__head">
          <h1>Documents collected</h1>
          <p>{message ?? 'The documents run has ended.'}</p>
        </header>
        <dl className="tally tally--three" aria-label="Documents totals">
          <div><dt>Approved tenders</dt><dd>{collected.length}</dd></div>
          <div className="tally--keep"><dt>With files saved</dt><dd>{withFiles.length}</dd></div>
          <div><dt>Files saved</dt><dd>{total('saved')}</dd></div>
        </dl>
        <div className="report__next">
          <p>{withFiles.length === collected.length ? 'Every approved tender now has its files. They are copied to Drive as well.' : 'Tenders without files are offered again on Today, so you can collect them later.'}</p>
          <button type="button" className="btn btn--quiet" onClick={onDecide}>Back to Today</button>
        </div>
        <section className="block">
          <h2>Tenders</h2>
          <ul className="verdicts">
            {collected.map((tender) => {
              const saved = tender.documents.filter((document) => document.state === 'DOWNLOADED').length;
              const failed = tender.documents.filter((document) => document.state === 'FAILED').length;
              return (
                <li key={tender.id} className="verdict">
                  <span className={saved > 0 ? 'mark mark--keep' : 'mark mark--look'}>{saved > 0 ? 'Saved' : 'Not yet'}</span>
                  <span className="verdict__title">{tender.title}</span>
                  <span className="verdict__reason">{tender.documents.length === 0 ? 'No files found for it.' : `${saved} of ${plural(tender.documents.length, 'file')} saved${failed ? `, ${failed} not saved` : ''}.`}</span>
                </li>
              );
            })}
          </ul>
        </section>
        <button type="button" className="btn btn--quiet btn--small" onClick={() => onOpenRun(lines[0].detail.jobId)}>See the run</button>
      </div>
    );
  }

  return (
    <div className="page report">
      <header className="page__head">
        <h1>Search session report</h1>
        <p>{message ?? 'The search session has ended.'}</p>
      </header>

      <dl className="tally" aria-label="Session totals">
        <div><dt>Dates searched</dt><dd>{lines.length}</dd></div>
        <div><dt>Tenders found</dt><dd>{total('found')}</dd></div>
        <div className="tally--keep"><dt>Kept</dt><dd>{total('kept')}</dd></div>
        <div><dt>Rejected</dt><dd>{total('rejected')}</dd></div>
        <div className="tally--look"><dt>Need a look</dt><dd>{total('look')}</dd></div>
        <div><dt>Files saved</dt><dd>{total('saved')}</dd></div>
      </dl>

      {waiting > 0 ? (
        <div className="report__next">
          <p>{plural(waiting, 'tender')} {waiting === 1 ? 'is' : 'are'} waiting for your decision.</p>
          <button type="button" className="btn btn--primary btn--large" onClick={onDecide}>Decide them now <ArrowRightIcon /></button>
        </div>
      ) : (
        <div className="report__next">
          <p>Nothing new needs a decision. Every tender found was rejected against your intent; open a date to see why.</p>
          <button type="button" className="btn btn--quiet" onClick={onDecide}>Back to Today</button>
        </div>
      )}

      {problems.length > 0 && (
        <div className="notice notice--attention">
          <AlertIcon />
          <span>
            <strong>Some parts did not finish.</strong> Search those dates again later.
            {problems.map((problem) => <span key={problem} className="notice__line">{problem}</span>)}
          </span>
        </div>
      )}

      <section className="block">
        <h2>Date by date</h2>
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">Published date</th><th scope="col">Result</th><th scope="col" className="num">Found</th>
              <th scope="col" className="num">Kept</th><th scope="col" className="num">Rejected</th><th scope="col" className="num">Need a look</th><th scope="col" className="num">Files</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const status = runStatus(line.detail.jobState, false);
              return (
                <tr key={line.detail.jobId} tabIndex={0} onClick={() => onOpenRun(line.detail.jobId)}
                  onKeyDown={(event) => { if (event.key === 'Enter') onOpenRun(line.detail.jobId); }}>
                  <td className="ledger__strong">{publishedLabel(line.detail.runConfiguration?.searchDate ?? null)}</td>
                  <td><span className={`status status--${status.tone}`}>{status.text}</span></td>
                  <td className="num">{line.found}</td>
                  <td className="num">{line.kept > 0 ? <strong>{line.kept}</strong> : 0}</td>
                  <td className="num">{line.rejected}</td>
                  <td className="num">{line.look}</td>
                  <td className="num">{line.saved}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {keptTenders.length > 0 && (
        <section className="block">
          <h2>Kept tenders</h2>
          <ul className="verdicts">
            {keptTenders.map(({ tender, date }) => {
              const saved = tender.documents.filter((document) => document.state === 'DOWNLOADED').length;
              return (
                <li key={tender.id} className="verdict">
                  <span className="mark mark--keep">Kept</span>
                  <span className="verdict__title">{tender.title}</span>
                  <span className="verdict__reason">Published {publishedLabel(date)}</span>
                  <span className="verdict__files">{tender.documents.length > 0 ? `${saved} of ${plural(tender.documents.length, 'file')} saved`
                    : tender.opportunityLifecycle && !['NEW', 'SCREENED'].includes(tender.opportunityLifecycle) ? 'Files saved in an earlier search' : 'No files saved'}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
