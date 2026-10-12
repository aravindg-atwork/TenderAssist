import { useEffect, useState } from 'react';
import { plainError } from '../words';

type Mode = 'PER_WEBSITE' | 'ONE_PER_DAY';

/** One report sheet per website each day (the default), or one sheet for the whole day. */
export function ReportSheetsSetting() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { window.tenderAssist.getReportSheets().then(setMode).catch((err) => setError(plainError(err))); }, []);

  const choose = async (next: Mode) => {
    setError(null);
    setDone(null);
    try {
      setMode(await window.tenderAssist.saveReportSheets(next));
      setDone('Saved. The sheets already saved are being rewritten this way, on this computer and on Drive.');
    } catch (err) { setError(plainError(err)); }
  };

  return (
    <>
      <h3 className="block__sub">Report sheets</h3>
      <p className="block__lede">Each day folder has a report sheet of the tenders kept that day. Several searches on one day, on one website, always share its sheet.</p>
      <div className="choices" role="radiogroup" aria-label="Report sheets">
        {([
          ['PER_WEBSITE', 'A sheet for each website', 'Approved-Tenders-12-10-2026 - Tamil Nadu.xlsx, Approved-Tenders-12-10-2026 - GeM.xlsx. Recommended.'],
          ['ONE_PER_DAY', 'One sheet for the day', 'Every website’s tenders in Approved-Tenders-12-10-2026.xlsx, with a Website column.'],
        ] as const).map(([value, label, hint]) => (
          <label key={value} className={mode === value ? 'choice is-chosen' : 'choice'}>
            <input type="radio" name="report-sheets" checked={mode === value} disabled={!mode} onChange={() => void choose(value)} />
            <span className="choice__label">{label}</span>
            <span className="choice__hint">{hint}</span>
          </label>
        ))}
      </div>
      {error && <p className="notice notice--stop" role="alert">{error}</p>}
      {done && !error && <p className="hint" role="status">{done}</p>}
    </>
  );
}
