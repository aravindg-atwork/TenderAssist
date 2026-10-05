// renderer/src/components/JobList.tsx
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import type { AuthJobUpdate, JobListItem, RecoveryJob, RunHistorySummary, RunSettingsState, SettingsSection } from '../../../src/electron/ipcTypes';
import { StatePill } from './StatePill';
import { TrashIcon } from './icons';
import type { PreflightReport } from '../../../src/system/preflight';
import { RunWorkspace } from './RunWorkspace';
import { DEFAULT_PORTAL_ID, getPortalDefinition } from '../../../src/config/portalRegistry';
import { PortalCompatibilityBadge, PortalSelect } from './PortalSelect';

export interface JobListProps {
  onSelectJob: (jobId: string) => void;
  activeJobId: string | null;
  activeJobUpdate: AuthJobUpdate | null;
  onActiveJobChange: (jobId: string | null) => void;
  settings: RunSettingsState | null;
  onOpenSettings: (section?: SettingsSection) => void;
  selectedPortalId: string;
  onPortalChange: (portalId: string) => void;
  onOpenInbox: () => void;
}

const OPENWEBSTART_DOWNLOAD_URL = 'https://openwebstart.com/download/';
// How long the signer may take to appear before help is offered.
const SIGNER_HELP_DELAY_MS = 60_000;

const todayIso = (): string => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const RUN_PHASES = [
  { phase: 'AUTH', label: 'Sign in', detail: 'Credentials, CAPTCHA and DSC' },
  { phase: 'SEARCH', label: 'Search', detail: 'Find tenders for the selected date' },
  { phase: 'CLASSIFICATION', label: 'Review', detail: 'Check each tender against intent' },
  { phase: 'ACQUISITION', label: 'Download', detail: 'Save shortlisted tender documents' },
  { phase: 'EXTRACTION', label: 'Extract', detail: 'Read requirements and key details' },
  { phase: 'PUBLISHING', label: 'Save', detail: 'Create the report in the local folder' },
] as const;

export function JobList({ onSelectJob, activeJobId, activeJobUpdate, onActiveJobChange, settings, onOpenSettings, selectedPortalId, onPortalChange, onOpenInbox }: JobListProps) {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchDate, setSearchDate] = useState(todayIso());
  const [untilDate, setUntilDate] = useState(todayIso());
  const [moreFrom, setMoreFrom] = useState(todayIso());
  const [moreTo, setMoreTo] = useState(todayIso());
  const [moreBusy, setMoreBusy] = useState(false);
  const [launchingDsc, setLaunchingDsc] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [recoveryJob, setRecoveryJob] = useState<RecoveryJob | null>(null);
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [history, setHistory] = useState<RunHistorySummary>({ recentRunDates: [], missedDates: [] });
  const [finishedRun, setFinishedRun] = useState<{ jobId: string; message: string } | null>(null);
  const [startNotice, setStartNotice] = useState<string | null>(null);
  const [signerSlow, setSignerSlow] = useState(false);
  const selectedPortal = getPortalDefinition(selectedPortalId);

  const refresh = useCallback(() => {
    window.tenderAssist
      .listJobs()
      .then(setJobs)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
    window.tenderAssist.getRecoveryJob().then(setRecoveryJob).catch(() => {});
    const unsubscribe = window.tenderAssist.onJobUpdate((update) => {
      if (update.outcome === 'SUCCESS' && update.phase === 'PUBLISHING' && update.statusMessage) {
        setFinishedRun({ jobId: update.jobId, message: update.statusMessage });
      }
      if (update.outcome) {
        refresh();
        window.tenderAssist.getRunHistory(selectedPortalId).then(setHistory).catch(() => {});
      }
    });
    return unsubscribe;
  }, [refresh, selectedPortalId]);

  useEffect(() => {
    let current = true;
    setCheckingReadiness(true);
    Promise.all([
      window.tenderAssist.runPreflight(selectedPortalId),
      window.tenderAssist.getRunHistory(selectedPortalId),
    ]).then(([readiness, nextHistory]) => {
      if (!current) return;
      setPreflight(readiness);
      setHistory(nextHistory);
    }).catch(() => {}).finally(() => current && setCheckingReadiness(false));
    return () => { current = false; };
  }, [selectedPortalId]);

  // If the signer window never appears, say why instead of waiting silently.
  const signerLaunched = activeJobUpdate?.authStep === 'DSC_LAUNCHED';
  useEffect(() => {
    setSignerSlow(false);
    if (!signerLaunched) return;
    const timer = setTimeout(() => setSignerSlow(true), SIGNER_HELP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [signerLaunched]);

  const openHelp = (url: string) => {
    window.tenderAssist.openHelpLink(url).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const handleRunMoreDates = async () => {
    setMoreBusy(true);
    setError(null);
    try {
      await window.tenderAssist.runMoreDates(moreFrom, moreTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoreBusy(false);
    }
  };

  const handleFinishRun = async () => {
    setMoreBusy(true);
    setError(null);
    try {
      await window.tenderAssist.finishRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoreBusy(false);
    }
  };

  const retryInterruptedJob = async () => {
    if (!recoveryJob) return;
    setStarting(true);
    setError(null);
    try {
      await window.tenderAssist.dismissRecoveryJob(recoveryJob.jobId);
      setSearchDate(recoveryJob.config.searchDate);
      setUntilDate(recoveryJob.config.searchDate);
      onPortalChange(recoveryJob.config.portalId ?? DEFAULT_PORTAL_ID);
      const { jobId } = await window.tenderAssist.startJob(recoveryJob.config);
      setRecoveryJob(null);
      onActiveJobChange(jobId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setStarting(false); }
  };

  const resumeInterruptedJob = async () => {
    if (!recoveryJob) return;
    setStarting(true);
    setError(null);
    try {
      setSearchDate(recoveryJob.config.searchDate);
      onPortalChange(recoveryJob.config.portalId ?? DEFAULT_PORTAL_ID);
      const { jobId } = await window.tenderAssist.resumeJob(recoveryJob.jobId);
      setRecoveryJob(null);
      onActiveJobChange(jobId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setStarting(false); }
  };

  const dismissInterruptedJob = async () => {
    if (!recoveryJob) return;
    try {
      await window.tenderAssist.dismissRecoveryJob(recoveryJob.jobId);
      setRecoveryJob(null);
      refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const handleStart = async () => {
    if (!settings?.configured) {
      onOpenSettings('relevance');
      return;
    }
    setStarting(true);
    setError(null);
    setFinishedRun(null);
    setStartNotice(null);
    try {
      const readiness = await window.tenderAssist.runPreflight(selectedPortalId);
      setPreflight(readiness);
      const blocker = readiness.checks.find((check) => check.level === 'BLOCKED');
      if (blocker) throw new Error(blocker.message);
      const { jobId, skipped } = await window.tenderAssist.startJob(
        { searchDate, portalId: selectedPortalId, ...settings.defaults },
        untilDate > searchDate ? untilDate : searchDate
      );
      if (skipped.length > 0) setStartNotice(`Already run, skipped: ${skipped.join(', ')}`);
      onActiveJobChange(jobId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleLaunchDsc = async () => {
    if (!activeJobId) return;
    setLaunchingDsc(true);
    setError(null);
    try {
      await window.tenderAssist.launchDscSigner(activeJobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunchingDsc(false);
    }
  };

  const handleStop = async () => {
    if (!activeJobId || stopping) return;
    setStopping(true);
    setError(null);
    try {
      await window.tenderAssist.cancelJob(activeJobId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopping(false);
    }
  };

  const assistCopy = activeJobUpdate?.awaitingMoreDates
    ? { title: 'Done. Run other dates?', body: `${activeJobUpdate.statusMessage ?? ''} The portal is still signed in, so other published dates can run now without another CAPTCHA or DSC.` }
    : activeJobUpdate?.phase === 'AUTH'
    ? activeJobUpdate.authStep === 'CAPTCHA_REQUIRED'
      ? { title: 'Enter the CAPTCHA below', body: 'Your saved login ID and password are filled. Enter the visible CAPTCHA and select Proceed in the embedded portal.' }
      : activeJobUpdate.authStep === 'DSC_READY'
        ? { title: 'DSC signer is ready', body: 'Launch the verified signer file, then select your certificate and enter the DSC password in the signer window.' }
        : activeJobUpdate.authStep === 'DSC_LAUNCHED'
          ? signerSlow
            ? { title: 'The DSC signer has not finished', body: 'If no Java or OpenWebStart window opened, OpenWebStart may be missing or blocked: install it, then select Launch DSC signer again. If a signer window is open, check that your DSC token is plugged in, choose the certificate, and enter the DSC password.' }
            : { title: 'DSC signer opened', body: 'Select Run in the Java prompt, then choose your certificate and enter the DSC password. TenderAssist will continue after the portal confirms the signature.' }
        : activeJobUpdate.authStep === 'DSC_LOGIN_STARTING'
          ? { title: 'Preparing the DSC signer', body: 'TenderAssist selected DSC Login and is validating the trusted signData.jnlp download. The launch button will appear when it is ready.' }
      : activeJobUpdate.authStep === 'AUTH_ERROR'
          ? { title: 'Portal action required', body: activeJobUpdate.recoveryAction ?? 'Resolve the message in the embedded portal, then retry.' }
      : activeJobUpdate.authStep === 'LOGIN_REQUIRED'
          ? { title: 'Complete login below', body: 'Saved credentials were not available or the login form needs attention. Sign in in the embedded portal; TenderAssist will continue when the dashboard appears.' }
          : activeJobUpdate.authStep === 'AUTHENTICATED'
            ? { title: 'Login confirmed', body: 'TenderAssist is continuing the run.' }
            : { title: `Opening ${selectedPortal.name}`, body: activeJobUpdate.statusMessage ?? 'TenderAssist is preparing the secure embedded login page.' }
    : activeJobUpdate?.phase === 'SEARCH'
      ? { title: 'Screening before favourite', body: activeJobUpdate.statusMessage ?? 'TenderAssist is reading titles first and opening details only when the title is not decisive.' }
      : activeJobUpdate?.phase === 'CLASSIFICATION'
        ? { title: 'Verifying shortlisted tenders', body: 'Each favourite in My Tenders is checked against your saved categories and intent. Nothing needs you yet.' }
        : activeJobUpdate?.phase === 'ACQUISITION' && (activeJobUpdate.jobState === 'SESSION_EXPIRED' || activeJobUpdate.jobState === 'AUTH_REQUIRED')
          ? { title: 'Sign in again to continue', body: activeJobUpdate.statusMessage ?? 'The portal signed you out. Files already saved are kept; sign in below and downloads will continue.' }
        : activeJobUpdate?.phase === 'ACQUISITION'
          ? { title: 'Downloading tender documents', body: 'Documents and zip files for shortlisted and needs-review tenders are being saved to your local output folder. You decide on them in the Inbox afterwards.' }
          : activeJobUpdate?.phase === 'EXTRACTION'
            ? { title: 'Reading tender requirements', body: 'TenderAssist is extracting the important requirements from approved documents.' }
            : activeJobUpdate?.phase === 'PUBLISHING'
              ? { title: 'Saving the report', body: 'The workbook and tender folders are being written to your local output folder. Tenders go to Drive when you approve them in the Inbox.' }
              : null;

  const handleDelete = async (event: MouseEvent, jobId: string) => {
    event.stopPropagation();
    if (!window.confirm('Delete this job and its history? This cannot be undone.')) return;
    setError(null);
    try {
      await window.tenderAssist.deleteJob(jobId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (activeJobId) {
    const currentPhase = activeJobUpdate?.phase ?? 'AUTH';
    const currentPhaseIndex = RUN_PHASES.findIndex((item) => item.phase === currentPhase);
    const activeState = activeJobUpdate?.jobState ?? 'SCHEDULED';

    const guide = (
        <aside className="run-sidebar" aria-label="Job progress and controls">
          <div className="run-sidebar__header">
            <div>
              <span className="run-sidebar__status-label">Job in progress</span>
              <h1>{selectedPortal.name}</h1>
            </div>
            <StatePill state={activeState} />
          </div>

          <dl className="run-sidebar__meta">
            <div><dt>Published date</dt><dd>{activeJobUpdate?.searchDate ?? searchDate}</dd></div>
            {activeJobUpdate?.batch && activeJobUpdate.batch.dates.length > 1 && (
              <div>
                <dt>Dates</dt>
                <dd>{Math.min(activeJobUpdate.batch.done.length + (activeJobUpdate.awaitingMoreDates ? 0 : 1), activeJobUpdate.batch.dates.length)} of {activeJobUpdate.batch.dates.length}</dd>
              </div>
            )}
            <div><dt>Job ID</dt><dd>{activeJobId.slice(0, 8)}</dd></div>
          </dl>

          <ol className="run-phase-list" aria-label="Job workflow">
            {RUN_PHASES.map((item, index) => {
              const status = index < currentPhaseIndex ? 'complete' : index === currentPhaseIndex ? 'current' : 'pending';
              return (
                <li className={`run-phase run-phase--${status}`} key={item.phase} aria-current={status === 'current' ? 'step' : undefined}>
                  <span className="run-phase__marker">{index + 1}</span>
                  <div><strong>{item.label}</strong><span>{item.detail}</span></div>
                </li>
              );
            })}
          </ol>

          <section className="run-action-card" aria-live="polite">
            <h2>{assistCopy?.title ?? 'TenderAssist is working'}</h2>
            <p>{assistCopy?.body ?? 'The workflow will continue automatically. Keep this window open.'}</p>
            {activeJobUpdate?.dscFileName && <span className="auth-assist-panel__file">{activeJobUpdate.dscFileName}</span>}
            {(activeJobUpdate?.authStep === 'DSC_READY' || signerLaunched) && (
              <button
                className={signerLaunched ? 'btn btn-secondary run-action-card__button' : 'btn btn-primary run-action-card__button'}
                type="button"
                onClick={handleLaunchDsc}
                disabled={launchingDsc}
              >
                {launchingDsc ? 'Launching…' : signerLaunched ? 'Launch DSC signer again' : 'Launch DSC signer'}
              </button>
            )}
            {signerLaunched && signerSlow && (
              <button className="btn btn-secondary run-action-card__button" type="button" onClick={() => openHelp(OPENWEBSTART_DOWNLOAD_URL)}>
                Download OpenWebStart
              </button>
            )}
          </section>

          {activeJobUpdate?.awaitingMoreDates && (
            <section className="more-dates" aria-labelledby="more-dates-title">
              <h2 id="more-dates-title">Run other published dates</h2>
              <div className="more-dates__range">
                <label>
                  <span>From</span>
                  <input type="date" value={moreFrom} max={todayIso()} onChange={(event) => setMoreFrom(event.target.value)} disabled={moreBusy} />
                </label>
                <label>
                  <span>To</span>
                  <input type="date" value={moreTo} min={moreFrom} max={todayIso()} onChange={(event) => setMoreTo(event.target.value)} disabled={moreBusy} />
                </label>
              </div>
              <p className="more-dates__hint">Each date is searched on its own as the published date. Dates already run are skipped.</p>
              <div className="more-dates__actions">
                <button className="btn btn-primary" type="button" onClick={handleRunMoreDates} disabled={moreBusy || !moreFrom || !moreTo}>
                  Run these dates
                </button>
                <button className="btn btn-secondary" type="button" onClick={handleFinishRun} disabled={moreBusy}>
                  Finish and sign out
                </button>
              </div>
            </section>
          )}

          {error && <p className="error-text run-sidebar__error">{error}</p>}
          <div className="run-sidebar__footer">
            <p>You can safely stop and return to the jobs list at any time.</p>
            <button className="btn btn-danger run-sidebar__stop" type="button" onClick={handleStop} disabled={stopping}>
              {stopping ? 'Stopping job…' : 'Stop job'}
            </button>
          </div>
        </aside>
    );
    return <RunWorkspace guide={guide} portalId={selectedPortal.id} portalName={selectedPortal.name} update={activeJobUpdate} />;
  }

  return (
    <div className="jobs-page">
      <div className="list-header">
        <div>
          <h1>Runs</h1>
          <p className="page-subtitle">Search, review, and shortlist tenders against your saved intent.</p>
        </div>
        <div className="run-controls">
          <label className="portal-control" htmlFor="job-portal">
            <span>Tender website</span>
            <PortalSelect id="job-portal" value={selectedPortalId} onChange={onPortalChange} disabled={starting || activeJobId !== null} />
          </label>
          <label className="date-control" htmlFor="job-search-date">
            <span>Published from</span>
            <input
              id="job-search-date"
              type="date"
              value={searchDate}
              max={todayIso()}
              onChange={(event) => {
                setSearchDate(event.target.value);
                if (untilDate < event.target.value) setUntilDate(event.target.value);
              }}
              disabled={starting || activeJobId !== null}
            />
          </label>
          <label className="date-control" htmlFor="job-until-date">
            <span>Published to</span>
            <input
              id="job-until-date"
              type="date"
              value={untilDate}
              min={searchDate}
              max={todayIso()}
              onChange={(event) => setUntilDate(event.target.value)}
              disabled={starting || activeJobId !== null}
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={handleStart}
            disabled={starting || !settings}
          >
            {starting ? 'Opening portal…' : untilDate > searchDate ? 'Start jobs for these dates' : 'Start job'}
          </button>
        </div>
      </div>
      <section className="run-context" aria-label="Selected portal and run history">
          <div className="run-context__portal">
            <div>
              <span className="run-context__label">READY TO RUN</span>
              <strong>{selectedPortal.name}</strong>
            </div>
            <PortalCompatibilityBadge portal={selectedPortal} />
          </div>
          <div className="run-history">
            <span className="run-history__label">Last 5 run dates</span>
            {history.recentRunDates.length > 0 ? history.recentRunDates.map((date) => (
              <span className="date-chip" key={date}>{date}</span>
            )) : <span className="run-history__empty">No previous runs for this portal</span>}
            <span className="run-history__hint">Run history only. Choose the publication date above for the next job.</span>
          </div>
          {history.missedDates.length > 0 && (
            <div className="missed-days">
              <span>Possible missed dates</span>
              <p>{history.missedDates.slice(0, 10).join(', ')}{history.missedDates.length > 10 ? ` +${history.missedDates.length - 10} more` : ''}</p>
            </div>
          )}
      </section>
      {settings && !settings.configured && (
        <div className="notice notice-attention setup-notice">
          <span>Finish the relevance settings before your first run.</span>
          <button className="btn btn-secondary" onClick={() => onOpenSettings('relevance')}>Open settings</button>
        </div>
      )}
      {finishedRun && !activeJobId && (
        <section className="notice run-finished" aria-live="polite">
          <span>{finishedRun.message}</span>
          <div className="run-finished__actions">
            <button className="btn btn-secondary" onClick={() => onSelectJob(finishedRun.jobId)}>View run</button>
            <button className="btn btn-primary" onClick={onOpenInbox}>Open Inbox</button>
          </div>
        </section>
      )}
      {startNotice && !activeJobId && <p className="notice">{startNotice}</p>}
      {recoveryJob && !activeJobId && (
        <section className="recovery-panel" aria-live="polite">
          <div><h2>Interrupted job found</h2><p>Job {recoveryJob.jobId.slice(0, 8)} stopped during {recoveryJob.state.toLowerCase().replaceAll('_', ' ')}. {recoveryJob.resumeDescription}</p></div>
          <div className="recovery-panel__actions">
            <button className="btn btn-secondary" onClick={dismissInterruptedJob}>End job</button>
            {recoveryJob.resume === 'START_OVER' ? (
              <button className="btn btn-primary" onClick={retryInterruptedJob} disabled={starting}>Start again</button>
            ) : (
              <>
                <button className="btn btn-secondary" onClick={retryInterruptedJob} disabled={starting}>Start again</button>
                <button className="btn btn-primary" onClick={resumeInterruptedJob} disabled={starting}>Continue job</button>
              </>
            )}
          </div>
        </section>
      )}
      {preflight && preflight.checks.some((check) => check.level !== 'PASS') && !activeJobId && (
        <details className="readiness-panel" open={!preflight.ready}>
          <summary>{preflight.ready ? 'Readiness warnings' : 'Setup required before starting'}</summary>
          <ul>{preflight.checks.filter((check) => check.level !== 'PASS').map((check) => (
            <li key={check.id}>
              <strong>{check.label}</strong>
              <span>{check.message}</span>
              {check.helpUrl && (
                <button className="btn btn-secondary readiness-panel__help" onClick={() => openHelp(check.helpUrl!)}>
                  {check.id === 'jnlp' ? 'Download OpenWebStart' : 'Open help'}
                </button>
              )}
            </li>
          ))}</ul>
          <button className="btn btn-secondary" disabled={checkingReadiness} onClick={async () => {
            setCheckingReadiness(true);
            try { setPreflight(await window.tenderAssist.runPreflight(selectedPortalId)); }
            finally { setCheckingReadiness(false); }
          }}>{checkingReadiness ? 'Checking…' : 'Run checks again'}</button>
        </details>
      )}
      {error && <p className="error-text">{error}</p>}
      {jobs.length === 0 ? (
        <div className="data-table">
          <p className="empty-state">No jobs yet. Start one to begin.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Job state</th>
              <th>Portal</th>
              <th>Published date</th>
              <th>Auth state</th>
              <th>Created</th>
              <th>Updated</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.jobId} onClick={() => onSelectJob(job.jobId)}>
                <td className="job-id">{job.jobId.slice(0, 8)}</td>
                <td>
                  <StatePill state={job.jobState} />
                </td>
                <td>{getPortalDefinition(job.portalId).name}</td>
                <td>{job.searchDate ?? '—'}</td>
                <td>
                  <StatePill state={job.authState} />
                </td>
                <td>{job.createdAt}</td>
                <td>{job.updatedAt}</td>
                <td className="col-actions">
                  {job.jobId !== activeJobId && (
                    <button
                      className="icon-btn icon-btn-danger"
                      title="Delete job"
                      aria-label="Delete job"
                      onClick={(event) => handleDelete(event, job.jobId)}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
