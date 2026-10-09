import { Fragment, useCallback, useEffect, useState } from 'react';
import type { DailyReportView } from '../../../src/electron/ipcTypes';
import { getPortalDefinition } from '../../../src/config/portalRegistry';
import { PortalSelect } from './PortalSelect';
import { RefreshIcon } from './icons';
import { relativeTime } from '../format';
import { plainError } from '../words';

const isoOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const daysAgo = (days: number) => { const date = new Date(); date.setDate(date.getDate() - days); return isoOf(date); };
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const RANGES = [{ days: 7, label: 'Last 7 days' }, { days: 14, label: 'Last 14 days' }, { days: 30, label: 'Last 30 days' }];
const n = (value: number | null) => (value === null ? '–' : value.toLocaleString('en-IN'));

export interface ReportsPageProps {
  portalId: string;
  onPortalChange: (portalId: string) => void;
}

/**
 * The daily report: for each published day, how many tenders the website
 * published, how many were in your categories, how many were shortlisted
 * for you, and how that splits by category.
 */
export function ReportsPage({ portalId, onPortalChange }: ReportsPageProps) {
  const [range, setRange] = useState(7);
  const [report, setReport] = useState<DailyReportView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const portal = getPortalDefinition(portalId);

  const load = useCallback(() => window.tenderAssist.getDailyReport(portalId, daysAgo(range - 1), daysAgo(0))
    .then((next) => { setReport(next); setError(null); })
    .catch((err) => setError(plainError(err))), [portalId, range]);
  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try { await window.tenderAssist.refreshWebsiteTotals(portalId); await load(); }
    catch (err) { setError(plainError(err)); }
    finally { setRefreshing(false); }
  };

  const reading = refreshing || report?.totalsReading;
  return (
    <div className="page report-page">
      <header className="page__head">
        <h1>Daily report</h1>
        <p>For each day: how many tenders {portal.name} published, how many were in your categories, and how many TenderAssist shortlisted for you.</p>
      </header>

      <div className="report-controls">
        <label className="field">
          <span>Website</span>
          <PortalSelect id="report-portal" value={portalId} onChange={onPortalChange} />
        </label>
        <div className="report-controls__ranges" role="group" aria-label="Days">
          {RANGES.map((item) => (
            <button key={item.days} type="button" className={range === item.days ? 'preset is-on' : 'preset'} onClick={() => setRange(item.days)}>{item.label}</button>
          ))}
        </div>
        {report && !report.gem && (
          <div className="report-controls__totals">
            <button type="button" className="btn btn--line btn--sm" disabled={Boolean(reading)} onClick={() => void refresh()}>
              <RefreshIcon /> {reading ? 'Reading the website… about two minutes' : 'Refresh website totals'}
            </button>
            <span className="hint">{report.totalsReadAt ? `Website totals read ${relativeTime(report.totalsReadAt)}.` : 'Website totals not read yet.'}</span>
          </div>
        )}
      </div>

      {error && <div className="alert alert--stop" role="alert"><p>{error}</p></div>}
      {!report && !error && <p className="page__empty">Loading…</p>}

      {report && (
        <>
          <dl className="tally tally--four" aria-label="Totals for these days">
            <div><dt>On the website</dt><dd>{n(report.totals.onWebsite)}</dd></div>
            <div><dt>In your categories</dt><dd>{n(report.totals.found)}</dd></div>
            <div className="tally--keep"><dt>Shortlisted for you</dt><dd>{n(report.totals.shortlisted)}</dd></div>
            <div><dt>Approved by you</dt><dd>{n(report.totals.approved)}</dd></div>
          </dl>
          <p className="report-average">
            Per working day ({report.averages.workingDays} {report.averages.workingDays === 1 ? 'day' : 'days'} with tenders):
            {report.averages.onWebsite !== null && <> <strong>{report.averages.onWebsite}</strong> on the website,</>}
            {' '}<strong>{report.averages.found}</strong> in your categories, <strong>{report.averages.shortlisted}</strong> shortlisted.
          </p>

          <section className="table-card">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" className="num">On the website</th>
                  <th scope="col" className="num">In your categories</th>
                  <th scope="col" className="num">Shortlisted</th>
                  <th scope="col" className="num">Need a look</th>
                  <th scope="col" className="num">Rejected</th>
                  <th scope="col" className="num">Approved</th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((day) => {
                  const expanded = open === day.date;
                  const empty = !day.searched && day.found === 0;
                  return (
                    <Fragment key={day.date}>
                      <tr className={expanded ? 'is-open' : undefined}>
                        <th scope="row">
                          <button type="button" className="report-day" aria-expanded={expanded} disabled={day.categories.length === 0}
                            onClick={() => setOpen(expanded ? null : day.date)}>
                            <span className="report-day__date">{dayLabel(day.date)}</span>
                            <span className="report-day__weekday">{day.weekday}{empty ? ' · not searched' : ''}</span>
                          </button>
                        </th>
                        <td className="num">{n(day.onWebsite)}</td>
                        <td className="num">{empty ? '–' : n(day.found)}</td>
                        <td className="num num--keep">{empty ? '–' : n(day.shortlisted)}</td>
                        <td className="num">{empty ? '–' : n(day.unsure)}</td>
                        <td className="num">{empty ? '–' : n(day.rejected)}</td>
                        <td className="num">{empty ? '–' : n(day.approved)}</td>
                      </tr>
                      {expanded && (
                        <tr className="report-breakdown">
                          <td colSpan={7}>
                            <table className="report-table report-table--inner">
                              <thead>
                                <tr>
                                  <th scope="col">Category</th>
                                  {report.gem && <th scope="col" className="num">On the website</th>}
                                  <th scope="col" className="num">Found</th>
                                  <th scope="col" className="num">Shortlisted</th>
                                  <th scope="col" className="num">Approved</th>
                                </tr>
                              </thead>
                              <tbody>
                                {day.categories.map((row) => (
                                  <tr key={row.category}>
                                    <th scope="row">{row.category}</th>
                                    {report.gem && <td className="num">{n(row.onWebsite)}</td>}
                                    <td className="num">{n(row.found)}</td>
                                    <td className="num num--keep">{n(row.shortlisted)}</td>
                                    <td className="num">{n(row.approved)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>

          {report.categories.length > 0 && (
            <section className="block">
              <h2>By category, these days</h2>
              <div className="table-card">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      {report.gem && <th scope="col" className="num">On the website</th>}
                      <th scope="col" className="num">Found</th>
                      <th scope="col" className="num">Shortlisted</th>
                      <th scope="col" className="num">Approved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.categories.map((row) => (
                      <tr key={row.category}>
                        <th scope="row">{row.category}</th>
                        {report.gem && <td className="num">{n(row.onWebsite)}</td>}
                        <td className="num">{n(row.found)}</td>
                        <td className="num num--keep">{n(row.shortlisted)}</td>
                        <td className="num">{n(row.approved)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="hint">
            {report.gem
              ? `On the website: every GeM ${report.gemProductsIncluded ? 'service and product' : 'service'} bid that started that day, counted when that day was searched. Shortlisted also counts bids outside your categories that mention your words. Click a day to see its categories.`
              : `On the website: tenders ${portal.name} published that day, read from its public lists. A tender leaves those lists when it closes, so older days can show fewer than were published. Click a day to see its categories.`}
          </p>
        </>
      )}
    </div>
  );
}
