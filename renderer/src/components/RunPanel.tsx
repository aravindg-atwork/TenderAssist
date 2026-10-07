import { useEffect, useState } from 'react';
import type { AuthJobUpdate, RunQuestion } from '../../../src/electron/ipcTypes';
import { AlertIcon, KeyIcon, RefreshIcon, StopIcon } from './icons';
import { plainError } from '../words';

const OPENWEBSTART_DOWNLOAD_URL = 'https://openwebstart.com/download/';
// How long the DSC signer may take before help is offered.
const SIGNER_HELP_DELAY_MS = 60_000;

const STEPS = [
  { phase: 'AUTH', label: 'Sign in' },
  { phase: 'SEARCH', label: 'Search' },
  { phase: 'CLASSIFICATION', label: 'Read tenders' },
  { phase: 'FILES', label: 'Save files' },
] as const;

function stepIndex(phase: string | undefined): number {
  if (!phase || phase === 'AUTH') return 0;
  if (phase === 'SEARCH') return 1;
  if (phase === 'CLASSIFICATION') return 2;
  return 3;
}

const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const dayLabel = (iso: string) => {
  const date = new Date(`${iso}T00:00:00`);
  return { day: date.toLocaleDateString('en-IN', { day: 'numeric' }), month: date.toLocaleDateString('en-IN', { month: 'short' }) };
};

interface Instruction { title: string; body: string; needsYou: boolean }

/** One plain instruction for the moment: what is happening, and whether the operator is needed. */
function instructionFor(update: AuthJobUpdate | null, signerSlow: boolean, portalName: string, noSignIn: boolean): Instruction {
  if (!update) {
    return noSignIn
      ? { title: `Opening ${portalName}`, body: 'Reading the list of bids. No sign-in is needed, so you can leave this running.', needsYou: false }
      : { title: `Opening ${portalName}`, body: 'Preparing the portal. This can take a minute when the portal is slow.', needsYou: false };
  }
  if (update.question) {
    return { title: 'TenderAssist is unsure about a tender', body: noSignIn ? 'Open the bid document to read it, then keep or skip it below.' : 'Look at the tender in the portal, then keep or skip it below.', needsYou: true };
  }
  if (update.awaitingMoreDates) return { title: 'All dates are done', body: update.statusMessage ?? 'Every chosen date has been searched.', needsYou: true };
  if (update.phase === 'AUTH') {
    switch (update.authStep) {
      case 'CAPTCHA_REQUIRED':
        return { title: 'Type the CAPTCHA in the portal', body: 'Your login ID and password are filled in. Type the characters you see and select Proceed.', needsYou: true };
      case 'LOGIN_REQUIRED':
        return { title: 'Sign in on the portal', body: 'TenderAssist could not fill your login. Type your login ID, password and the CAPTCHA, then select Proceed.', needsYou: true };
      case 'DSC_LOGIN_STARTING':
        return { title: 'Getting the DSC signer', body: 'TenderAssist asked the portal for the signer. Its button appears here in a moment.', needsYou: false };
      case 'DSC_READY':
        return { title: 'Start the DSC signer', body: 'Select Launch DSC signer below, then choose your certificate and enter your DSC PIN in the window that opens.', needsYou: true };
      case 'DSC_LAUNCHED':
        return signerSlow
          ? { title: 'The DSC signer has not finished', body: 'If it said “Please run latest downloaded DataSigner utility”, select OK and Get a new DSC signer. If no Java window opened at all, OpenWebStart may be missing. Check your DSC token is plugged in.', needsYou: true }
          : { title: 'Finish the DSC signer', body: 'In the signer window: select Run, choose your certificate and enter your DSC PIN. TenderAssist carries on by itself afterwards.', needsYou: true };
      case 'AUTH_ERROR':
        return { title: 'The portal needs your attention', body: update.recoveryAction ?? 'Read the message in the portal, then try again.', needsYou: true };
      case 'AUTHENTICATED':
        return { title: 'Signed in', body: 'Getting started.', needsYou: false };
      default:
        return { title: `Opening ${portalName}`, body: update.statusMessage ?? 'Preparing the sign-in page.', needsYou: false };
    }
  }
  if (update.phase === 'ACQUISITION' && (update.jobState === 'SESSION_EXPIRED' || update.jobState === 'AUTH_REQUIRED')) {
    return { title: 'Sign in again to continue', body: update.statusMessage ?? 'The portal signed you out. Files already saved are kept.', needsYou: true };
  }
  if (update.phase === 'SEARCH') {
    return noSignIn
      ? { title: `Searching ${portalName}`, body: update.statusMessage ?? 'Finding the bids that started on this date.', needsYou: false }
      : { title: 'Searching the portal', body: update.statusMessage ?? 'Reading titles and ticking possible tenders into My Tenders.', needsYou: false };
  }
  if (update.phase === 'CLASSIFICATION') {
    return noSignIn
      ? { title: 'Reading each bid', body: update.statusMessage ?? 'Reading the bid document of each bid in your categories and deciding from it.', needsYou: false }
      : { title: 'Reading each tender', body: update.statusMessage ?? 'Opening each favourite in My Tenders and deciding from its full details.', needsYou: false };
  }
  return { title: 'Saving files', body: update.statusMessage ?? (noSignIn ? 'Writing each kept tender’s documents and eligibility sheet to your folder.' : 'Writing each kept tender’s documents, zip and eligibility sheet to your folder.'), needsYou: false };
}

/** Seconds left before the run stops waiting, ticking once a second. */
function useSecondsLeft(answerBy: string | undefined): number {
  const left = () => (answerBy ? Math.max(0, Math.ceil((Date.parse(answerBy) - Date.now()) / 1_000)) : 0);
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    if (!answerBy) return;
    const timer = setInterval(() => setSeconds(left()), 1_000);
    return () => clearInterval(timer);
  }, [answerBy]);
  return seconds;
}

/** "Keep or skip?" for one unsure tender, answered while its page is still open. */
function QuestionCard({ question, busy, onAnswer, onOpenDocument }: {
  question: RunQuestion; busy: boolean; onAnswer: (answer: 'KEEP' | 'SKIP') => void; onOpenDocument: () => void;
}) {
  const seconds = useSecondsLeft(question.answerBy);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  // A GeM bid is known by its bid number; its internal id means nothing to a person.
  const gem = Boolean(question.documentUrl);
  const facts = [
    ['Tender ID', gem ? null : question.tenderId],
    [gem ? 'Bid number' : 'Reference', question.reference],
    ['Organisation', question.organisation],
    ['Category', question.category],
    ['Closes', question.closingDate],
    ['Value', question.value],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]) && fact[1] !== 'NA');
  return (
    <section className="ask" aria-labelledby="ask-title">
      <h3 id="ask-title">Keep or skip?</h3>
      <p className="ask__title">{question.tenderTitle}</p>
      <p className="ask__reason">{question.reason}</p>
      {facts.length > 0 && (
        <dl className="ask__facts">
          {facts.map(([label, value]) => (<div key={label}><dt>{label}</dt><dd>{value}</dd></div>))}
        </dl>
      )}
      {question.documentUrl && (
        // On its own line, apart from the two answers, so reading never answers.
        <p className="ask__read">
          <button type="button" className="btn btn--quiet btn--small" onClick={onOpenDocument}>Open the bid document</button>
          <span>It opens in your web browser.</span>
        </p>
      )}
      <div className="ask__actions">
        <button type="button" className="btn btn--approve" disabled={busy} onClick={() => onAnswer('KEEP')}>Keep</button>
        <button type="button" className="btn btn--reject" disabled={busy} onClick={() => onAnswer('SKIP')}>Skip it</button>
      </div>
      <p className="ask__clock" aria-live="off">
        Keep approves it and saves its documents. Skip it rejects it. You can change either later under Tenders. With no answer in <strong>{clock}</strong>, it waits in Needs a look.
      </p>
    </section>
  );
}

export interface RunPanelProps {
  jobId: string;
  portalName: string;
  update: AuthJobUpdate | null;
  /** A website searched without signing in (GeM): no sign-in step. */
  noSignIn?: boolean;
}

/** The left side of a running search: what to do now, where the run is, and its controls. */
export function RunPanel({ jobId, portalName, update, noSignIn = false }: RunPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signerSlow, setSignerSlow] = useState(false);
  const [moreFrom, setMoreFrom] = useState(todayIso());
  const [moreTo, setMoreTo] = useState(todayIso());
  const [moreAgain, setMoreAgain] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  // Answers given in this run stay on screen, so a click is never in doubt.
  const [answers, setAnswers] = useState<Array<{ title: string; answer: 'KEEP' | 'SKIP' }>>([]);

  const signerLaunched = update?.authStep === 'DSC_LAUNCHED';
  useEffect(() => {
    setSignerSlow(false);
    if (!signerLaunched) return;
    const timer = setTimeout(() => setSignerSlow(true), SIGNER_HELP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [signerLaunched]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await work(); }
    catch (err) { setError(plainError(err)); }
    finally { setBusy(false); }
  };

  const instruction = instructionFor(update, signerSlow, portalName, noSignIn);
  const steps = noSignIn ? STEPS.filter((step) => step.phase !== 'AUTH') : STEPS;
  const current = noSignIn ? Math.max(0, stepIndex(update?.phase) - 1) : stepIndex(update?.phase);
  const batch = update?.batch;
  const searchDate = update?.searchDate;

  return (
    <aside className="run" aria-label="Search in progress">
      <header className="run__head">
        <span className="run__portal">{portalName}</span>
        {batch && batch.dates.length > 1 ? (
          <span className="run__count">Date {Math.min(batch.done.length + (update?.awaitingMoreDates ? 0 : 1), batch.dates.length)} of {batch.dates.length}</span>
        ) : searchDate ? <span className="run__count">{noSignIn ? 'Started' : 'Published'} {dayLabel(searchDate).day} {dayLabel(searchDate).month}</span> : null}
      </header>

      <section className={instruction.needsYou ? 'now now--you' : 'now'} aria-live="polite">
        <h2 className="now__title">{instruction.title}</h2>
        <p className="now__body">{instruction.body}</p>
        {update?.authStep === 'DSC_READY' && (
          <button type="button" className="btn btn--primary btn--large" disabled={busy} onClick={() => act(() => window.tenderAssist.launchDscSigner(jobId))}>
            <KeyIcon /> Launch DSC signer
          </button>
        )}
        {signerLaunched && (
          <div className="now__actions">
            <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => act(() => window.tenderAssist.refreshDscSigner(jobId))}>
              <RefreshIcon /> Get a new DSC signer
            </button>
            {signerSlow && (
              <button type="button" className="btn btn--quiet" onClick={() => act(() => window.tenderAssist.openHelpLink(OPENWEBSTART_DOWNLOAD_URL))}>
                Download OpenWebStart
              </button>
            )}
          </div>
        )}
        {update?.dscFileName && update.phase === 'AUTH' && <p className="now__file">Signer file: {update.dscFileName}</p>}
      </section>

      {update?.question && (
        <QuestionCard key={update.question.id} question={update.question} busy={busy}
          onAnswer={(answer) => {
            const asked = update.question!;
            void act(async () => {
              await window.tenderAssist.answerRunQuestion(asked.id, answer);
              setAnswers((done) => [...done, { title: asked.tenderTitle, answer }]);
            });
          }}
          onOpenDocument={() => act(() => window.tenderAssist.openQuestionDocument(update.question!.id))} />
      )}

      {answers.length > 0 && (
        <section className="answered" aria-label="Your answers in this run">
          <h3>Your answers in this run</h3>
          <ul>
            {answers.map((item, index) => (
              <li key={index}>
                <strong>{item.answer === 'KEEP' ? 'Kept (approved)' : 'Skipped (rejected)'}:</strong> {item.title}
              </li>
            ))}
          </ul>
        </section>
      )}

      {update?.awaitingMoreDates && (
        <section className="more" aria-labelledby="more-title">
          <h3 id="more-title">Search other dates now?</h3>
          <p>The portal is still signed in, so there is no new CAPTCHA or DSC.</p>
          <div className="more__dates">
            <label className="field"><span>From</span>
              <input type="date" value={moreFrom} max={todayIso()} disabled={busy} onChange={(event) => {
                const next = event.target.value;
                if (moreTo === moreFrom || moreTo < next) setMoreTo(next);
                setMoreFrom(next);
              }} />
            </label>
            <label className="field"><span>to</span>
              <input type="date" value={moreTo} min={moreFrom} max={todayIso()} disabled={busy} onChange={(event) => setMoreTo(event.target.value)} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={moreAgain} disabled={busy} onChange={(event) => setMoreAgain(event.target.checked)} />
            Search already-run dates again
          </label>
          <div className="more__actions">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => act(() => window.tenderAssist.runMoreDates(moreFrom, moreTo, { runAgain: moreAgain }))}>
              Search these dates
            </button>
            <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => act(() => window.tenderAssist.finishRun())}>
              Finish and sign out
            </button>
          </div>
        </section>
      )}

      {batch && batch.dates.length > 1 && (
        <section className="dates" aria-label="Dates in this search">
          <ol className="dates__strip">
            {batch.dates.map((date) => {
              const isDone = batch.done.includes(date);
              const isNow = !isDone && date === searchDate && !update?.awaitingMoreDates;
              const label = dayLabel(date);
              return (
                <li key={date} className={isDone ? 'date is-done' : isNow ? 'date is-now' : 'date'} aria-current={isNow ? 'step' : undefined}
                  title={isDone ? 'Searched' : isNow ? 'Searching now' : 'Still to search'}>
                  <span className="date__day">{label.day}</span>
                  <span className="date__month">{label.month}</span>
                </li>
              );
            })}
          </ol>
          {batch.skipped.length > 0 && <p className="dates__note">{batch.skipped.length} already searched before, skipped.</p>}
        </section>
      )}

      {!update?.awaitingMoreDates && (
        <ol className="steps" aria-label="Steps for this date">
          {steps.map((step, index) => (
            <li key={step.phase} className={index < current ? 'step is-done' : index === current ? 'step is-now' : 'step'} aria-current={index === current ? 'step' : undefined}>
              {step.label}
            </li>
          ))}
        </ol>
      )}

      {error && <p className="notice notice--stop" role="alert"><AlertIcon /><span>{error}</span></p>}

      <footer className="run__foot">
        {confirmStop ? (
          <div className="stop-confirm">
            <span>Stop this search? Tenders and files found so far are kept.</span>
            <button type="button" className="btn btn--reject btn--small" disabled={busy} onClick={() => act(() => window.tenderAssist.cancelJob(jobId))}>Stop</button>
            <button type="button" className="btn btn--quiet btn--small" onClick={() => setConfirmStop(false)}>Keep going</button>
          </div>
        ) : (
          <button type="button" className="btn btn--quiet btn--small run__stop" onClick={() => setConfirmStop(true)}>
            <StopIcon /> Stop search
          </button>
        )}
      </footer>
    </aside>
  );
}
