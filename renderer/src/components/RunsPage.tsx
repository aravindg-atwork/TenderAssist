import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { JobListItem } from '../../../src/electron/ipcTypes';
import { getPortalDefinition } from '../../../src/config/portalRegistry';
import { relativeTime, absoluteDateTime } from '../format';
import { plainError, publishedLabel, runStatus } from '../words';
import { SearchIcon, TrashIcon } from './icons';
import { FilterPills, Pager, usePage } from './Pager';
import { Stops, type Tone } from './Tracking';

const STATUS_TONE: Record<string, Tone> = { done: 'keep', working: 'now', stopped: 'reject', problem: 'look' };

export interface RunsPageProps {
  activeJobId: string | null;
  onOpenRun: (jobId: string) => void;
}

type ResultFilter = 'all' | 'done' | 'stopped' | 'problem' | 'documents';

/** Every search TenderAssist has run, newest first, in plain words. */
const runName = (run: JobListItem) => run.purpose === 'DOCUMENTS' ? 'the documents run' : `the search for ${publishedLabel(run.searchDate)}`;

export function RunsPage({ activeJobId, onOpenRun }: RunsPageProps) {
  const [runs, setRuns] = useState<JobListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState('all');
  const [result, setResult] = useState<ResultFilter>('all');
  const [query, setQuery] = useState('');

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

  const all = runs ?? [];
  const websites = useMemo(() => [...new Set(all.map((run) => run.portalId))], [all]);
  const toneOf = (run: JobListItem) => runStatus(run.jobState, run.jobId === activeJobId).tone;
  const inWebsite = all.filter((run) => website === 'all' || run.portalId === website);
  const matchesResult = (run: JobListItem, filter: ResultFilter) =>
    filter === 'all' ? true
      : filter === 'documents' ? run.purpose === 'DOCUMENTS'
        : filter === 'stopped' ? toneOf(run) === 'stopped'
          : filter === 'problem' ? toneOf(run) === 'problem'
            : toneOf(run) === 'done' || toneOf(run) === 'working';
  const needle = query.trim().toLocaleLowerCase();
  const filtered = inWebsite.filter((run) => matchesResult(run, result)
    && (!needle || `${publishedLabel(run.searchDate)} ${run.searchDate ?? ''} ${getPortalDefinition(run.portalId).name}`.toLocaleLowerCase().includes(needle)));
  const { page, pages, shown, setPage } = usePage(filtered, `${website}|${result}|${needle}`);

  const resultOptions: Array<{ id: ResultFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: inWebsite.length },
    { id: 'done', label: 'Finished', count: inWebsite.filter((run) => matchesResult(run, 'done')).length },
    { id: 'stopped', label: 'Stopped', count: inWebsite.filter((run) => matchesResult(run, 'stopped')).length },
    { id: 'problem', label: 'Did not finish', count: inWebsite.filter((run) => matchesResult(run, 'problem')).length },
    { id: 'documents', label: 'Documents runs', count: inWebsite.filter((run) => matchesResult(run, 'documents')).length },
  ];

  return (
    <div className="page">
      <header className="page__head">
        <h1>Runs</h1>
      </header>
      {error && <p className="notice notice--stop" role="alert">{error}</p>}
      {!runs && !error && <p className="page__empty">Loading…</p>}
      {runs && runs.length === 0 && <div className="desk__empty"><h2>No searches yet</h2><p>Start one from Today.</p></div>}
      {runs && runs.length > 0 && (
        <>
          <div className="toolbar">
            <FilterPills label="Result" value={result} options={resultOptions.filter((option) => option.id === 'all' || option.count > 0)} onChange={setResult} />
            <div className="toolbar__right">
              {websites.length > 1 && (
                <label className="field field--inline">
                  <span className="visually-hidden">Website</span>
                  <select value={website} onChange={(event) => setWebsite(event.target.value)}>
                    <option value="all">All websites</option>
                    {websites.map((id) => <option key={id} value={id}>{getPortalDefinition(id).name}</option>)}
                  </select>
                </label>
              )}
              <label className="search">
                <SearchIcon />
                <span className="visually-hidden">Find a date</span>
                <input type="search" value={query} placeholder="Find a date, e.g. 7 Oct" onChange={(event) => setQuery(event.target.value)} />
              </label>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="desk__empty"><h2>No runs match</h2><p>Change the filters above to see more.</p></div>
          ) : (
            <div className="table-card">
              <ul className="runrows">
                {shown.map((run) => {
                  const status = runStatus(run.jobState, run.jobId === activeJobId);
                  const date = run.searchDate ? new Date(`${run.searchDate}T00:00:00`) : null;
                  const stops: Array<{ label: string; tone: Tone }> = run.purpose === 'DOCUMENTS'
                    ? [
                      { label: 'Approved', tone: 'done' },
                      { label: `${run.tendersFound} opened`, tone: run.tendersFound > 0 ? 'done' : 'todo' },
                      { label: `${run.kept} with files`, tone: run.kept > 0 ? 'keep' : 'done' },
                      { label: status.text, tone: STATUS_TONE[status.tone] },
                    ]
                    : [
                      { label: 'Searched', tone: 'done' },
                      { label: `${run.tendersFound.toLocaleString('en-IN')} found`, tone: run.tendersFound > 0 ? 'done' : 'todo' },
                      { label: `${run.kept} kept`, tone: run.kept > 0 ? 'keep' : 'done' },
                      { label: status.text, tone: STATUS_TONE[status.tone] },
                    ];
                  return (
                    <li key={run.jobId} className="runrow">
                      <button type="button" className="runrow__main" onClick={() => onOpenRun(run.jobId)}>
                        <span className="runrow__date">
                          {run.purpose === 'DOCUMENTS' ? <strong>Files</strong> : date ? <><strong>{date.getDate()}</strong><small>{date.toLocaleDateString('en-IN', { month: 'short', weekday: 'short' })}</small></> : <strong>?</strong>}
                        </span>
                        <span className="runrow__what">
                          <span className="runrow__title">{run.purpose === 'DOCUMENTS' ? 'Documents for approved tenders' : getPortalDefinition(run.portalId).name}</span>
                          <span className="runrow__meta">Searched <span title={absoluteDateTime(run.createdAt)}>{relativeTime(run.createdAt)}</span></span>
                        </span>
                        <Stops stops={stops} label="How this run went" />
                      </button>
                      {run.jobId !== activeJobId && (
                        <button type="button" className="btn btn--icon runrow__delete" aria-label={`Delete the record of ${runName(run)}`} onClick={(event) => remove(event, run)}>
                          <TrashIcon />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Pager page={page} pages={pages} total={filtered.length} onPage={setPage} noun="runs" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
