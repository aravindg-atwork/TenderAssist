import { useEffect, useState } from 'react';
import type { BidResultLine, BidResults } from '../../../src/electron/ipcTypes';

function ResultTable({ title, lines }: { title: string; lines: BidResultLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="table-card">
      <table className="report-table">
        <thead>
          <tr><th scope="col">{title}</th><th scope="col" className="num">Submitted</th><th scope="col" className="num">Won</th><th scope="col" className="num">Lost</th><th scope="col" className="num">Won of decided</th></tr>
        </thead>
        <tbody>
          {lines.slice(0, 12).map((line) => (
            <tr key={line.name}>
              <th scope="row">{line.name}</th>
              <td className="num">{line.submitted}</td>
              <td className="num num--keep">{line.won}</td>
              <td className="num">{line.lost}</td>
              <td className="num">{line.won + line.lost > 0 ? `${Math.round((100 * line.won) / (line.won + line.lost))}%` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Reports → Your bids: approved, submitted, won and lost over all time, and
 * which categories and intent words the wins came from, from Bid progress on
 * each tender's file.
 */
export function BidResultsSection() {
  const [results, setResults] = useState<BidResults | null>(null);
  useEffect(() => { window.tenderAssist.getBidResults().then(setResults).catch(() => setResults(null)); }, []);
  if (!results || results.approved === 0) return null;
  return (
    <section className="block">
      <h2>Your bids</h2>
      <p className="block__lede">
        {results.approved} approved, {results.submitted} submitted, {results.won} won, {results.lost} lost
        {results.notSubmitted > 0 ? `, ${results.notSubmitted} not submitted` : ''}.
      </p>
      {results.submitted === 0
        ? <p className="hint">Mark each approved tender on its Bid tab (Submitted, then Won or Lost) to see which categories and words win.</p>
        : (
          <>
            <ResultTable title="Category" lines={results.byCategory} />
            <ResultTable title="Intent or search word" lines={results.byWord} />
            <p className="hint">Words that keep winning are worth keeping; categories that never win can be dropped in Settings → What to look for.</p>
          </>
        )}
    </section>
  );
}
