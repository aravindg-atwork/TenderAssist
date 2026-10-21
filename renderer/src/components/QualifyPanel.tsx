import { useState } from 'react';
import type { CheckStatus, QualifyReport } from '../../../src/electron/ipcTypes';

const STATUS: Record<CheckStatus, { mark: string; label: string }> = {
  NOT_MET: { mark: '✕', label: 'Not met' },
  CHECK: { mark: '?', label: 'Check' },
  MET: { mark: '✓', label: 'Met' },
};
const ORDER: CheckStatus[] = ['NOT_MET', 'CHECK', 'MET'];

/**
 * "Do we qualify?" on a tender's file: its eligibility criteria checked
 * against the company's facts, the ones not met first, so a tender the
 * company cannot bid for shows it before anything else.
 */
export function QualifyPanel({ report }: { report: QualifyReport }) {
  const [open, setOpen] = useState(report.notMet > 0);
  if (report.checks.length === 0) return null;
  const sorted = [...report.checks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const shown = open ? sorted : sorted.filter((check) => check.status === 'NOT_MET').slice(0, 3);
  const verdict = !report.profileFilled
    ? 'Fill in Settings → Your company to check these against your company.'
    : report.notMet > 0
      ? `Your company does not meet ${report.notMet} of ${report.checks.length}.`
      : report.toCheck > 0
        ? `Meets ${report.met} of ${report.checks.length}; ${report.toCheck} to read yourself.`
        : `Meets all ${report.met}.`;
  return (
    <section className={`qualify qualify--${report.notMet > 0 ? 'no' : report.toCheck > 0 || !report.profileFilled ? 'check' : 'yes'}`} aria-label="Do we qualify?">
      <div className="qualify__head">
        <h3 className="unread__title">Do we qualify?</h3>
        <p className="qualify__verdict">{verdict}</p>
        <span className="qualify__counts" aria-hidden="true">
          {report.notMet > 0 && <span className="qualify__count qualify__count--NOT_MET">{report.notMet} not met</span>}
          {report.toCheck > 0 && <span className="qualify__count qualify__count--CHECK">{report.toCheck} to check</span>}
          {report.met > 0 && <span className="qualify__count qualify__count--MET">{report.met} met</span>}
        </span>
      </div>
      {shown.length > 0 && (
        <ul className="qualify__list">
          {shown.map((check, index) => (
            <li key={`${check.source}-${index}`} className={`qualify__item qualify__item--${check.status}`}>
              <span className="qualify__mark" aria-label={STATUS[check.status].label}>{STATUS[check.status].mark}</span>
              <span className="qualify__text">
                <strong>{check.reason}</strong>
                <span className="qualify__req">{check.requirement}</span>
                <span className="qualify__src">{check.source}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn--quiet btn--small" onClick={() => setOpen(!open)}>
        {open ? 'Show fewer' : `Show all ${report.checks.length} criteria`}
      </button>
    </section>
  );
}
