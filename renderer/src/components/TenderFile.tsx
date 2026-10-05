import { useEffect, useState } from 'react';
import type { TenderFileView, TenderSummary, TimelineEntry } from '../../../src/electron/ipcTypes';
import { getPortalDefinition } from '../../../src/config/portalRegistry';
import { absoluteDateTime, closingLabel, LIFECYCLE_LABELS, relativeTime } from '../format';
import { RelatedTenders } from './RelatedTenders';
import { CheckIcon, ClockIcon, CrossIcon, DocumentIcon, FolderIcon, ZipIcon } from './icons';

export interface FileAction {
  id: string;
  label: string;
  /** approve: the file's main action; later: beside it; reject: set apart; plain: a quiet secondary. */
  kind: 'approve' | 'later' | 'reject' | 'plain';
  run: (note: string | undefined) => void;
}

export interface TenderFileProps {
  tender: TenderSummary;
  actions: FileAction[];
  busy?: boolean;
  /** Shown as the latest note when the tender is waiting for a decision. */
  waitingNote?: string;
  onDismissRelated?: (otherId: string) => void;
}

type Tab = 'summary' | 'documents' | 'history';

const RECOMMENDATION_TAG: Record<string, { text: string; tone: string }> = {
  KEEP: { text: 'Kept by TenderAssist', tone: 'keep' },
  UNCERTAIN: { text: 'Needs a look', tone: 'review' },
  REJECT: { text: 'Rejected by TenderAssist', tone: 'reject' },
};

function valueText(value: string | null): string {
  return value && value !== 'NA' ? `₹${value}` : 'Not stated';
}

function DocumentRow({ name, state, error }: { name: string; state: string; error: string | null }) {
  const isZip = /\.zip$/i.test(name) || /zip/i.test(name);
  return (
    <li className={`doc doc--${state.toLowerCase()}`}>
      {isZip ? <ZipIcon /> : <DocumentIcon />}
      <span className="doc__name">{name}</span>
      <span className="doc__state">
        {state === 'DOWNLOADED' ? 'Saved' : state === 'FAILED' ? 'Not saved' : 'Waiting'}
      </span>
      {state === 'FAILED' && error && <span className="doc__error">{error}</span>}
    </li>
  );
}

function History({ opportunityId }: { opportunityId: string }) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEntries(null);
    window.tenderAssist.getTenderTimeline(opportunityId).then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [opportunityId]);
  if (error) return <p className="file-empty" role="alert">{error}</p>;
  if (!entries) return <p className="file-empty">Loading history…</p>;
  if (entries.length === 0) return <p className="file-empty">Nothing recorded yet.</p>;
  return (
    <ol className="history">
      {entries.map((entry) => (
        <li key={entry.id} className={`history__entry history__entry--${entry.actor}`}>
          <time dateTime={entry.at} title={absoluteDateTime(entry.at)}>{relativeTime(entry.at)}</time>
          <span className="history__title">{entry.title}</span>
          {entry.detail && <span className="history__detail">{entry.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * A tender as an office file: a cover carrying its facts in fixed places,
 * tabs for what is inside, and a noting sheet where TenderAssist's reason
 * and the operator's decision are written.
 */
export function TenderFile({ tender, actions, busy = false, waitingNote, onDismissRelated }: TenderFileProps) {
  const [tab, setTab] = useState<Tab>('summary');
  const [file, setFile] = useState<TenderFileView | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [openingFolder, setOpeningFolder] = useState(false);

  useEffect(() => {
    let current = true;
    setFile(null);
    setFileError(null);
    setNote('');
    window.tenderAssist.getTenderFile(tender.id)
      .then((next) => { if (current) setFile(next); })
      .catch((err) => { if (current) setFileError(err instanceof Error ? err.message : String(err)); });
    return () => { current = false; };
  }, [tender.id]);

  const closing = closingLabel(tender.closingAt, tender.closingDate);
  // Once decided, a file is tagged by where it stands, not by TenderAssist's first call.
  const decided = tender.lifecycle !== 'NEW' && tender.lifecycle !== 'SCREENED';
  const tag = !decided && tender.recommendation ? RECOMMENDATION_TAG[tender.recommendation] : null;
  const savedDocuments = file?.documents.filter((document) => document.state === 'DOWNLOADED').length ?? 0;
  const openFolder = async () => {
    setOpeningFolder(true);
    try { await window.tenderAssist.openTenderFolder(tender.id); }
    catch (err) { setFileError(err instanceof Error ? err.message : String(err)); }
    finally { setOpeningFolder(false); }
  };
  const trimmedNote = note.trim() || undefined;
  const mainActions = actions.filter((action) => action.kind !== 'reject');
  const rejectActions = actions.filter((action) => action.kind === 'reject');

  return (
    <article className="file" aria-busy={busy} aria-label={tender.title}>
      <header className="file__cover">
        <div className="file__cover-top">
          <span className="file__number">{tender.tenderId}</span>
          {tag && <span className={`file-tag file-tag--${tag.tone}`}>{tag.text}</span>}
          {!tag && <span className="file-tag file-tag--plain">{LIFECYCLE_LABELS[tender.lifecycle] ?? tender.lifecycle}</span>}
        </div>
        <h2 className="file__title">{tender.title}</h2>
        <dl className="file__facts">
          <div><dt>Closes</dt><dd className={`closing closing--${closing.urgency}`} title={closing.title}>{closing.text}</dd></div>
          <div><dt>Value</dt><dd>{valueText(tender.value)}</dd></div>
          <div><dt>Department</dt><dd>{tender.department || tender.organisation?.split('||')[0] || 'Not stated'}</dd></div>
          <div><dt>Portal</dt><dd>{getPortalDefinition(tender.portalId).name}</dd></div>
        </dl>
      </header>

      <div className="file__tabs" role="tablist" aria-label="File contents">
        {([['summary', 'Summary'], ['documents', `Documents${file ? ` · ${savedDocuments}` : ''}`], ['history', 'History']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="file__tab" onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="file__body" role="tabpanel">
        {tab === 'summary' && (
          <>
            {fileError && <p className="file-empty" role="alert">{fileError}</p>}
            {file && file.keyFacts.length > 0 ? (
              <dl className="facts">
                {file.keyFacts.map((fact) => (
                  <div key={fact.label} className={fact.label === 'Work' || fact.label === 'Eligibility' ? 'facts__row facts__row--wide' : 'facts__row'}>
                    <dt>{fact.label}</dt><dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : file && (
              <p className="file-empty">
                {file.detailsRead
                  ? 'This tender was read before TenderAssist kept each portal field. Search its date again, with “Search already-run dates again” ticked, to fill in its details.'
                  : 'TenderAssist has not opened this tender’s details page yet. It will on the next search of its date.'}
              </p>
            )}
            {file && file.allFields.length > 0 && (
              <details className="all-fields">
                <summary>Everything on the portal page ({file.allFields.length} fields)</summary>
                <dl>{file.allFields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
              </details>
            )}
            <RelatedTenders related={tender.related} onDismiss={onDismissRelated} />
          </>
        )}
        {tab === 'documents' && (
          file && file.documents.length > 0 ? (
            <>
              <ul className="docs">{file.documents.map((document) => <DocumentRow key={document.id} {...document} />)}</ul>
              {file.hasFolder && (
                <button className="btn btn--quiet" type="button" onClick={openFolder} disabled={openingFolder}>
                  <FolderIcon /> {openingFolder ? 'Opening…' : 'Open the tender folder'}
                </button>
              )}
            </>
          ) : (
            <p className="file-empty">
              No documents yet. TenderAssist downloads the documents and the zip file of a tender it keeps, while it reads the tender.
            </p>
          )
        )}
        {tab === 'history' && <History opportunityId={tender.id} />}
      </div>

      <section className="sheet" aria-label="Noting sheet">
        <ol className="sheet__notes">
          <li className="note">
            <span className="note__who">TenderAssist</span>
            <span className="note__text">{tender.explanation}</span>
          </li>
          {waitingNote && (
            <li className="note note--waiting">
              <span className="note__who">Waiting for you</span>
              <span className="note__text">{waitingNote}</span>
            </li>
          )}
        </ol>
        {actions.length > 0 && (
          <>
            <label className="sheet__write">
              <span className="sheet__write-label">Your note</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={1000}
                placeholder="Optional: why you decided this" />
            </label>
            <div className="sheet__decide">
              {mainActions.map((action) => (
                <button key={action.id} type="button" disabled={busy}
                  className={action.kind === 'approve' ? 'btn btn--primary' : action.kind === 'later' ? 'btn btn--later' : 'btn btn--quiet'}
                  onClick={() => action.run(trimmedNote)}>
                  {action.kind === 'approve' && <CheckIcon />}
                  {action.kind === 'later' && <ClockIcon />}
                  {action.label}
                </button>
              ))}
              {rejectActions.length > 0 && (
                <span className="sheet__apart">
                  {rejectActions.map((action) => (
                    <button key={action.id} type="button" disabled={busy} className="btn btn--reject" onClick={() => action.run(trimmedNote)}>
                      <CrossIcon /> {action.label}
                    </button>
                  ))}
                </span>
              )}
            </div>
          </>
        )}
      </section>
    </article>
  );
}
