import { Fragment, useCallback, useEffect, useState } from 'react';
import type { DailyReportView, OperatorDecision, ReportTenderItem, TenderSummary } from '../../../src/electron/ipcTypes';
import { TenderFile, type FileAction } from './TenderFile';
import { getPortalDefinition } from '../../../src/config/portalRegistry';
import { PortalSelect } from './PortalSelect';
import { BackIcon, RefreshIcon } from './icons';
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
  // Choose dates: any From and To, instead of the last N days.
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [report, setReport] = useState<DailyReportView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [openTender, setOpenTender] = useState<TenderSummary | null>(null);
  const [deciding, setDeciding] = useState(false);
  const from = custom?.from ?? daysAgo(range - 1);
  const to = custom?.to ?? daysAgo(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const portal = getPortalDefinition(portalId);

  const load = useCallback(() => window.tenderAssist.getDailyReport(portalId, from, to)
    .then((next) => { setReport(next); setError(null); })
    .catch((err) => setError(plainError(err))), [portalId, from, to]);

  const openFile = (opportunityId: string) => {
    window.tenderAssist.getTenderSummary(opportunityId).then(setOpenTender).catch((err) => setError(plainError(err)));
  };
  const decide = async (tender: TenderSummary, decision: OperatorDecision, note?: string) => {
    setDeciding(true);
    try {
      await window.tenderAssist.decideTenders([tender.id], decision, note);
      setOpenTender(await window.tenderAssist.getTenderSummary(tender.id));
      await load();
    } catch (err) {
      setError(plainError(err));
    } finally {
      setDeciding(false);
    }
  };
  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try { await window.tenderAssist.refreshWebsiteTotals(portalId); await load(); }
    catch (err) { setError(plainError(err)); }
    finally { setRefreshing(false); }
  };

  const reading = refreshing || report?.totalsReading;
  if (openTender) {
    const actions: FileAction[] = [
      { id: 'approve', label: 'Approve', kind: 'approve', run: (note) => void decide(openTender, 'APPROVE', note) },
      { id: 'later', label: 'Decide later', kind: 'later', run: (note) => void decide(openTender, 'DEFER', note) },
      { id: 'reject', label: 'Reject', kind: 'reject', run: (note) => void decide(openTender, 'REJECT', note) },
      { id: 'reopen', label: 'Move back to review', kind: 'plain', run: (note) => void decide(openTender, 'REOPEN', note) },
    ];
    return (
      <div className="page page--desk">
        <button type="button" className="btn btn--quiet btn--small page__back" onClick={() => setOpenTender(null)}><BackIcon /> Daily report</button>
        {error && <p className="notice notice--stop" role="alert">{error}</p>}
        <TenderFile key={openTender.id} tender={openTender} busy={deciding} actions={actions} />
      </div>
    );
  }
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
            <button key={item.days} type="button" className={!custom && range === item.days ? 'preset is-on' : 'preset'} onClick={() => { setCustom(null); setRange(item.days); }}>{item.label}</button>
          ))}
          <button type="button" className={custom ? 'preset is-on' : 'preset'} onClick={() => setCustom(custom ? null : { from, to })}>Choose dates</button>
        </div>
        {custom && (
          <div className="report-controls__dates">
            <label className="field"><span>From</span>
              <input type="date" value={custom.from} max={custom.to} onChange={(event) => event.target.value && setCustom({ ...custom, from: event.target.value })} />
            </label>
            <label className="field"><span>To</span>
              <input type="date" value={custom.to} min={custom.from} max={daysAgo(0)} onChange={(event) => event.target.value && setCustom({ ...custom, to: event.target.value })} />
            </label>
          </div>
        )}
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
                                  <CategoryLine key={row.category} portalId={portalId} from={day.date} to={day.date} row={row} gem={report.gem} onOpen={openFile} />
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
              <p className="hint">Click a category to see its tenders; click a tender to open it.</p>
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
                      <CategoryLine key={row.category} portalId={portalId} from={from} to={to} row={row} gem={report.gem} onOpen={openFile} />
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

const VERDICT: Record<string, string> = { KEEP: 'Shortlisted', UNCERTAIN: 'Need a look', REJECT: 'Rejected', NOT_RUN: 'Not read' };

/** One category line; clicked, it lists the tenders behind its numbers. */
function CategoryLine({ portalId, from, to, row, gem, onOpen }: {
  portalId: string; from: string; to: string; gem: boolean; onOpen: (opportunityId: string) => void;
  row: { category: string; onWebsite: number | null; found: number; shortlisted: number; approved: number };
}) {
  const [items, setItems] = useState<ReportTenderItem[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const total = Math.max(row.found, row.shortlisted, row.approved, row.category === 'Other categories' ? row.onWebsite ?? 0 : 0);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !items) window.tenderAssist.getReportTenders(portalId, from, to, row.category).then(setItems).catch(() => setItems([]));
  };
  const columns = gem ? 5 : 4;
  return (
    <>
      <tr className={expanded ? 'is-open' : undefined}>
        <th scope="row">
          <button type="button" className="report-day" aria-expanded={expanded} disabled={total === 0} onClick={toggle}>
            <span className="report-day__date">{row.category}</span>
          </button>
        </th>
        {gem && <td className="num">{n(row.onWebsite)}</td>}
        <td className="num">{n(row.found)}</td>
        <td className="num num--keep">{n(row.shortlisted)}</td>
        <td className="num">{n(row.approved)}</td>
      </tr>
      {expanded && (
        <tr className="report-tenders">
          <td colSpan={columns}>
            {!items ? <p className="hint">Loading…</p> : items.length === 0 ? <p className="hint">No tenders.</p> : (
              <ul className="report-tenders__list">
                {items.map((item) => (
                  <li key={item.tenderId}>
                    <button type="button" className="report-tender" onClick={() => onOpen(item.opportunityId)}>
                      <span className={`mark mark--${item.approved ? 'keep' : item.verdict === 'KEEP' ? 'keep' : item.verdict === 'REJECT' ? 'reject' : 'look'}`}>
                        {item.approved ? 'Approved' : VERDICT[item.verdict] ?? item.verdict}
                      </span>
                      <span className="report-tender__title">{item.title}</span>
                      <span className="report-tender__meta">
                        {[item.tenderId, `found ${dayLabel(item.date)}`, item.closingDate && `closes ${item.closingDate}`].filter(Boolean).join(' · ')}
                      </span>
                      {item.reason && <span className="report-tender__why">{item.reason}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
