import { useEffect, useState } from 'react';
import { FilterPills, Pager, usePage } from './Pager';
import type { JobDetail, SettingsSection, TenderDetailItem } from '../../../src/electron/ipcTypes';
import type { ClassificationGateRow } from '../../../src/persistence/repositories/classificationRepository';
import { describePortalError } from '../../../src/orchestration/transientRetry';
import { getPortalDefinition } from '../../../src/config/portalRegistry';
import { plainError, plural, publishedLabel, runStatus } from '../words';
import { NoMatchesSummary } from './NoMatchesSummary';
import { BackIcon, FolderIcon, SearchIcon } from './icons';

export interface RunDetailProps {
  jobId: string;
  isActive: boolean;
  onBack: () => void;
  onOpenSettings: (section?: SettingsSection) => void;
}

function evidence(gate: ClassificationGateRow | undefined): Record<string, unknown> {
  if (!gate) return {};
  try { return JSON.parse(gate.evidence_json) as Record<string, unknown>; } catch { return {}; }
}

const words = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Why this tender was kept, rejected, or left for a look, in one plain sentence. */
function reasonFor(tender: TenderDetailItem): string {
  const byGate = new Map(tender.classificationGates.map((gate) => [gate.gate, gate]));
  if (tender.classificationGates.some((gate) => gate.reason_code === 'NOT_IN_MY_TENDERS')) {
    return 'No longer in your My Tenders on the portal, so it was not read. It waits in Needs a look for you to decide.';
  }
  if (tender.classificationGates.some((gate) => gate.reason_code === 'GEM_BID_DOCUMENT_FAILED')) {
    return 'GeM did not send its bid document, even after several tries. Run this date again to read it.';
  }
  const failed = tender.classificationGates.find((gate) => /REVIEW_FAILED/.test(gate.reason_code));
  if (failed) return `Its details page did not open, even on a second try (${String(evidence(failed).error ?? 'no answer from the portal')}).`;
  const excluded = words(evidence(byGate.get('G4')).matchedExcludedKeywords);
  if (byGate.get('G4')?.result === 'REJECT') return `Its title or category has an excluded word: ${excluded.join(', ') || 'an exclusion'}.`;
  if (byGate.get('G2')?.result === 'REJECT') return 'Its product category is not one you search for.';
  if (byGate.get('G1')?.result === 'REJECT') return 'It was published too long before this date.';
  const matched = words(evidence(byGate.get('G3')).matchedKeywords);
  if (byGate.get('G3')?.result === 'REJECT') return 'Its details do not mention any of your intent words.';
  if (byGate.get('G3')?.result === 'UNCERTAIN') return 'Waiting for its details to be read.';
  if (matched.length > 0) return `Mentions ${matched.map((word) => `“${word}”`).join(', ')}.`;
  return 'Passed every check.';
}

const DECISION_WORDS: Record<string, { text: string; tone: string }> = {
  KEEP: { text: 'Kept', tone: 'keep' },
  REJECT: { text: 'Rejected', tone: 'reject' },
  UNCERTAIN: { text: 'Needs a look', tone: 'look' },
  NOT_RUN: { text: 'Not checked', tone: 'plain' },
};

/** One search: what it looked at, what it decided, and why. */
export function RunDetail({ jobId, isActive, onBack, onOpenSettings }: RunDetailProps) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [decisionFilter, setDecisionFilter] = useState<'ALL' | 'KEEP' | 'UNCERTAIN' | 'REJECT' | 'NOT_RUN'>('ALL');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const load = () => window.tenderAssist.getJobDetail(jobId).then((next) => { setDetail(next); setError(null); })
      .catch((err) => setError(plainError(err)));
    void load();
    return window.tenderAssist.onJobUpdate((update) => { if (update.jobId === jobId) void load(); });
  }, [jobId]);

  const order: Record<string, number> = { KEEP: 0, UNCERTAIN: 1, REJECT: 2, NOT_RUN: 3 };
  const sorted = detail ? [...detail.tenders].sort((a, b) => order[a.effectiveClassification] - order[b.effectiveClassification]) : [];
  const needle = query.trim().toLocaleLowerCase();
  const filtered = sorted.filter((tender) => (decisionFilter === 'ALL' || tender.effectiveClassification === decisionFilter)
    && (!needle || tender.title.toLocaleLowerCase().includes(needle)));
  const { page, pages, shown, setPage } = usePage(filtered, `${decisionFilter}|${needle}`);

  const back = <button type="button" className="btn btn--quiet btn--small page__back" onClick={onBack}><BackIcon /> All runs</button>;
  if (error) return <div className="page">{back}<p className="notice notice--stop" role="alert">{error}</p></div>;
  if (!detail) return <div className="page">{back}<p className="page__empty">Loading…</p></div>;

  const status = runStatus(detail.jobState, isActive);
  const count = (decision: string) => detail.tenders.filter((tender) => tender.effectiveClassification === decision).length;
  const kept = count('KEEP');
  const failedSearches = detail.searches.filter((search) => search.state === 'FAILED');
  const config = detail.runConfiguration;
  const documentRun = detail.purpose === 'DOCUMENTS';

  if (detail.purpose === 'CHANGES') {
    // What the check found, as recorded when it finished.
    const finished = [...detail.jobTransitions].reverse().find((row) => row.to_state === 'COMPLETE');
    const summary = finished?.reason?.replace(/^check for changes complete:\s*/i, '') ?? null;
    const changed = detail.tenders.filter((tender) => (tender.changesFound?.length ?? 0) > 0);
    return (
      <div className="page">
        {back}
        <header className="page__head">
          <h1>Check for changes</h1>
          <p>
            <span className={`status status--${status.tone}`}>{status.text}</span>
            {config && <> on {getPortalDefinition(config.portalId).name}</>}
          </p>
        </header>
        <p className="lede">{summary && summary !== 'check for changes complete' ? summary : `${plural(detail.tenders.length, 'followed tender')} to check: ${changed.length} changed.`}</p>
        <section className="block">
          <h2>Followed tenders</h2>
          <ul className="verdicts">
            {detail.tenders.map((tender) => (
              <li key={tender.id} className="verdict">
                <span className={(tender.changesFound?.length ?? 0) > 0 ? 'mark mark--look' : 'mark mark--keep'}>{(tender.changesFound?.length ?? 0) > 0 ? 'Changed' : 'No change'}</span>
                <span className="verdict__title">{tender.title}</span>
                <span className="verdict__reason">
                  {tender.closing_date ? `Closes ${tender.closing_date}. ` : ''}
                  {(tender.changesFound ?? []).join(' ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      {back}
      <header className="page__head page__head--split">
        <div>
          <h1>{documentRun ? 'Documents for approved tenders' : `Search for ${publishedLabel(config?.searchDate ?? null)}`}</h1>
          <p>
            <span className={`status status--${status.tone}`}>{status.text}</span>
            {config && <> on {getPortalDefinition(config.portalId).name}</>}
          </p>
        </div>
        {!documentRun && (detail.jobState === 'COMPLETE' || detail.jobState === 'REPORTING') && (
          <button type="button" className="btn btn--quiet" disabled={opening} onClick={async () => {
            setOpening(true);
            try { await window.tenderAssist.openJobOutput(jobId); }
            catch (err) { setError(plainError(err)); }
            finally { setOpening(false); }
          }}>
            <FolderIcon /> {opening ? 'Opening…' : 'Open this date’s folder'}
          </button>
        )}
      </header>

      <p className="lede">
        {documentRun
          ? `Collected for ${plural(detail.tenders.length, 'approved tender')}: ${detail.tenders.filter((tender) => tender.documents.some((document) => document.state === 'DOWNLOADED')).length} now have their files saved.`
          : detail.tenders.length === 0
          ? 'No tenders were found for this date in your categories.'
          : `Found ${plural(detail.tenders.length, 'tender')}: ${kept} kept, ${count('REJECT')} rejected${count('UNCERTAIN') ? `, ${count('UNCERTAIN')} need a look` : ''}.`}
      </p>

      {failedSearches.length > 0 && (
        <div className="notice notice--attention">
          <span>
            <strong>{plural(failedSearches.length, 'category', 'categories')} could not be searched,</strong> so tenders there may be missing. Search this date again later.
            {failedSearches.map((search) => (
              <span key={search.id} className="notice__line">{search.product_category}: {search.last_error ? describePortalError(search.last_error) : 'no reason recorded'}</span>
            ))}
          </span>
        </div>
      )}

      {detail.searches.length > 0 && (
        <details className="disclosure" open={detail.searches.length <= 8}>
          <summary>Categories searched ({detail.searches.length})</summary>
          <ul className="register">
            {detail.searches.map((search) => (
              <li key={search.id} className={search.state === 'FAILED' ? 'is-failed' : undefined}>
                <span className="register__name" title={search.product_category}>{search.product_category}</span>
                <span className="num">{search.state === 'FAILED' ? 'could not be searched' : plural(search.result_count ?? 0, 'tender')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {kept === 0 && count('UNCERTAIN') === 0 && detail.jobState === 'COMPLETE' && (
        <NoMatchesSummary detail={detail} onEditSettings={() => onOpenSettings('relevance')} showCategories={false} />
      )}

      {sorted.length > 0 && (
        <section className="block">
          <h2>Tenders and why</h2>
          <div className="toolbar">
            <FilterPills label="Decision" value={decisionFilter} onChange={setDecisionFilter} options={[
              { id: 'ALL' as const, label: 'All', count: sorted.length },
              { id: 'KEEP' as const, label: 'Kept', count: kept },
              { id: 'UNCERTAIN' as const, label: 'Needs a look', count: count('UNCERTAIN') },
              { id: 'REJECT' as const, label: 'Rejected', count: count('REJECT') },
              { id: 'NOT_RUN' as const, label: 'Not checked', count: count('NOT_RUN') },
            ].filter((option) => option.id === 'ALL' || option.count > 0)} />
            <div className="toolbar__right">
              <label className="search">
                <SearchIcon />
                <span className="visually-hidden">Find a tender</span>
                <input type="search" value={query} placeholder="Find a tender by title" onChange={(event) => setQuery(event.target.value)} />
              </label>
            </div>
          </div>
          {filtered.length === 0 ? <p className="page__empty">No tenders match.</p> : (
            <div className="table-card">
              <ul className="verdicts verdicts--flat">
                {shown.map((tender) => {
                  const decision = DECISION_WORDS[tender.effectiveClassification] ?? DECISION_WORDS.NOT_RUN;
                  const saved = tender.documents.filter((document) => document.state === 'DOWNLOADED').length;
                  return (
                    <li key={tender.id} className="verdict">
                      <span className={`mark mark--${decision.tone}`}>{decision.text}</span>
                      <span className="verdict__title">{tender.title}</span>
                      <span className="verdict__reason">{reasonFor(tender)}</span>
                      {tender.documents.length > 0 && (
                        <span className="verdict__files">{saved} of {plural(tender.documents.length, 'file')} saved</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Pager page={page} pages={pages} total={filtered.length} onPage={setPage} noun="tenders" />
            </div>
          )}
        </section>
      )}

      {config && (
        <details className="disclosure">
          <summary>What this search looked for</summary>
          <dl className="facts">
            <div className="facts__row facts__row--wide"><dt>Categories</dt><dd>{config.productCategories.join(', ')}</dd></div>
            <div className="facts__row facts__row--wide"><dt>Intent words</dt><dd>{config.keywords.join(', ')}</dd></div>
            <div className="facts__row facts__row--wide"><dt>Excluded words</dt><dd>{config.excludedKeywords.join(', ') || 'None'}</dd></div>
          </dl>
        </details>
      )}

      <details className="disclosure disclosure--quiet">
        <summary>For support: step-by-step record</summary>
        <ol className="support-log">
          {[...detail.jobTransitions, ...detail.authTransitions]
            .filter((transition) => transition.reason)
            .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
            .map((transition) => (
              <li key={transition.id}>
                <time>{new Date(transition.occurred_at).toLocaleTimeString('en-IN')}</time>
                <span>{transition.reason}</span>
              </li>
            ))}
        </ol>
      </details>
    </div>
  );
}
