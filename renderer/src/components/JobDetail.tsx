import { useEffect, useState } from 'react';
import type {
  AuthJobUpdate,
  JobDetail as JobDetailData,
  TenderDetailItem,
} from '../../../src/electron/ipcTypes';
import type { ClassificationGateRow } from '../../../src/persistence/repositories/classificationRepository';
import { StatePill } from './StatePill';
import { getPortalDefinition } from '../../../src/config/portalRegistry';

export interface JobDetailProps {
  jobId: string;
  onBack: () => void;
}

const FLOW_STAGES = [
  { state: 'AUTHENTICATED', label: 'Signed in', detail: 'Embedded portal login confirmed' },
  { state: 'SEARCHING', label: 'Searched', detail: 'Titles screened before selected favourites' },
  { state: 'CLASSIFYING', label: 'Reviewed', detail: 'My Tenders details checked' },
  { state: 'SHORTLISTED', label: 'Shortlisted', detail: 'Intent gates completed' },
  { state: 'ACQUIRING_DOCUMENTS', label: 'Download', detail: 'Next phase: tender documents' },
  { state: 'PROCESSING_DOCUMENTS', label: 'Process', detail: 'Next phase: parse documents' },
  { state: 'UPLOADING', label: 'Publish', detail: 'Local workbook and optional Drive copy' },
  { state: 'COMPLETE', label: 'Complete', detail: 'Report and folder ready' },
] as const;

function safeEvidence(gate: ClassificationGateRow): Record<string, unknown> {
  try {
    return JSON.parse(gate.evidence_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function gateExplanation(gate: ClassificationGateRow): string {
  const evidence = safeEvidence(gate);
  if (gate.reason_code === 'DETAIL_REVIEW_FAILED' || gate.reason_code === 'PREFAVORITE_DETAIL_REVIEW_FAILED') {
    return String(evidence.error ?? 'Detail review failed');
  }
  const confidence = typeof evidence.confidence === 'string' ? evidence.confidence.toLowerCase() : null;
  const stage = typeof evidence.stage === 'string' ? evidence.stage.toLowerCase() : null;
  const prefix = confidence && stage ? `${confidence} confidence ${stage} check: ` : '';
  if (gate.gate === 'G1') {
    return gate.reason_code === 'SEARCH_DATE_FILTER_MATCH'
      ? `${prefix}matched the selected portal publication date`
      : `${prefix}published date passed the freshness check`;
  }
  if (gate.gate === 'G2') {
    const matched = stringList(evidence.matched);
    return matched.length ? `${prefix}category: ${matched.join(', ')}` : `${prefix}product category did not match`;
  }
  if (gate.gate === 'G3') {
    const matched = stringList(evidence.matchedKeywords);
    return matched.length ? `${prefix}intent: ${matched.join(', ')}` : `${prefix}no configured intent phrase found`;
  }
  const excluded = stringList(evidence.matchedExcludedKeywords);
  return excluded.length ? `${prefix}excluded scope: ${excluded.join(', ')}` : `${prefix}no excluded primary scope found`;
}

function requirementData(tender: TenderDetailItem): Record<string, string | null> {
  if (!tender.requirements) return {};
  try { return JSON.parse(tender.requirements.data_json) as Record<string, string | null>; }
  catch { return {}; }
}

function TenderCard({
  tender,
  onReviewed,
  selectable,
  selected,
  onToggleSelected,
}: {
  tender: TenderDetailItem;
  onReviewed: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: (tenderId: string, checked: boolean) => void;
}) {
  const displayCategory = tender.detail_product_category || tender.product_category;
  const identifier = tender.tender_portal_id || tender.tender_ref;
  const [reason, setReason] = useState(tender.manualReview?.reason ?? '');
  const [savingDecision, setSavingDecision] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const requirements = requirementData(tender);
  const saveDecision = async (decision: 'KEEP' | 'REJECT') => {
    setSavingDecision(true); setReviewError(null);
    try {
      await window.tenderAssist.saveTenderReview(tender.id, decision, reason);
      onReviewed();
    } catch (err) { setReviewError(err instanceof Error ? err.message : String(err)); }
    finally { setSavingDecision(false); }
  };
  return (
    <article className={`tender-card tender-card--${tender.effectiveClassification.toLowerCase()}`}>
      <div className="tender-card__topline">
        {selectable && (
          <label className="tender-card__select">
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={(event) => onToggleSelected?.(tender.id, event.target.checked)}
            />
            <span>Extract &amp; download this tender</span>
          </label>
        )}
        <span className="tender-card__id">{identifier}</span>
        <StatePill state={tender.effectiveClassification} />
      </div>
      <h3>{tender.title}</h3>
      <dl className="tender-facts">
        <div><dt>Reference</dt><dd>{tender.tender_ref}</dd></div>
        <div><dt>Category</dt><dd>{displayCategory || 'Not provided'}</dd></div>
        <div><dt>Organisation</dt><dd>{tender.organisation_chain || 'Not provided'}</dd></div>
        <div><dt>Department</dt><dd>{tender.department || 'Not provided'}</dd></div>
        <div><dt>State</dt><dd>{tender.state_name || 'Not provided'}</dd></div>
        <div><dt>Estimated value</dt><dd>{tender.value_in_rupees === 'NA' ? 'Not provided' : `₹${tender.value_in_rupees}`}</dd></div>
      </dl>
      {tender.classificationGates.length > 0 && (
        <div className="decision-strip" aria-label="Classification decisions">
          {tender.classificationGates.map((gate) => (
            <div className="decision-strip__item" key={gate.gate}>
              <span className={`decision-dot decision-dot--${gate.result.toLowerCase()}`} aria-hidden="true" />
              <span><strong>{gate.gate}</strong> {gateExplanation(gate)}</span>
            </div>
          ))}
        </div>
      )}
      {tender.requirements && (
        <details className="requirement-summary">
          <summary>Extracted requirements · {tender.requirements.confidence.toLowerCase()} confidence</summary>
          <dl>
            {Object.entries(requirements).filter(([, value]) => value).map(([key, value]) => (
              <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </details>
      )}
      {tender.documents.length > 0 && (
        <p className="document-status">Documents: {tender.documents.filter((item) => item.state === 'DOWNLOADED').length} downloaded, {tender.documents.filter((item) => item.state === 'FAILED').length} failed</p>
      )}
      {(tender.classification === 'UNCERTAIN' || tender.manualReview) && (
        <div className="review-controls">
          <label><span>Review note</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this tender is or is not relevant" /></label>
          <div className="review-controls__actions">
            <button className="btn btn-secondary" disabled={savingDecision} onClick={() => saveDecision('REJECT')}>Reject</button>
            <button className="btn btn-primary" disabled={savingDecision} onClick={() => saveDecision('KEEP')}>Keep tender</button>
          </div>
          {reviewError && <p className="error-text">{reviewError}</p>}
        </div>
      )}
    </article>
  );
}

export function JobDetail({ jobId, onBack }: JobDetailProps) {
  const [detail, setDetail] = useState<JobDetailData | null>(null);
  const [latestUpdate, setLatestUpdate] = useState<AuthJobUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingOutput, setOpeningOutput] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [confirmingSelection, setConfirmingSelection] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const load = () => {
    window.tenderAssist
      .getJobDetail(jobId)
      .then((next) => { setDetail(next); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(load, [jobId]);
  // Job resets to a fresh review as soon as a new run reaches SHORTLISTED --
  // re-seed the tick-box defaults (every KEEP checked, every needs-review
  // unchecked) once per job rather than on every poll re-load.
  useEffect(() => { setSelectedIds(null); }, [jobId]);

  useEffect(() => {
    const unsubscribe = window.tenderAssist.onJobUpdate((update) => {
      if (update.jobId !== jobId) return;
      setLatestUpdate(update);
      load();
    });
    return unsubscribe;
  }, [jobId]);

  // Seed the tick-box defaults once the job reaches SHORTLISTED: every
  // automatic KEEP starts checked (certain), every needs-review tender
  // starts unchecked (borderline -- opt in explicitly).
  useEffect(() => {
    if (!detail || selectedIds !== null || detail.jobState !== 'SHORTLISTED') return;
    setSelectedIds(new Set(detail.tenders.filter((tender) => tender.effectiveClassification === 'KEEP').map((tender) => tender.id)));
  }, [detail, selectedIds]);

  if (error) {
    return (
      <div>
        <button className="btn-link detail-back" onClick={onBack}>&larr; Jobs</button>
        <p className="error-text">Failed to load job: {error}</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div>
        <button className="btn-link detail-back" onClick={onBack}>&larr; Jobs</button>
        <p>Loading…</p>
      </div>
    );
  }

  const reached = new Set(detail.jobTransitions.map((transition) => transition.to_state));
  reached.add(detail.jobState);
  const shortlisted = detail.tenders.filter((tender) => tender.effectiveClassification === 'KEEP');
  const uncertain = detail.tenders.filter((tender) => tender.effectiveClassification === 'UNCERTAIN');
  const rejected = detail.tenders.filter((tender) => tender.effectiveClassification === 'REJECT');
  const bannerClass = latestUpdate?.outcome === 'ABORTED' ? 'notice notice-attention' : 'notice notice-success';

  return (
    <div>
      <button className="btn-link detail-back" onClick={onBack}>&larr; Jobs</button>
      <div className="detail-header">
        <div>
          <span className="job-reference">Job {detail.jobId.slice(0, 8)}</span>
          <h1>Tender review</h1>
        </div>
        <div className="detail-header__actions">
          {(detail.jobState === 'COMPLETE' || detail.jobState === 'REPORTING') && (
            <button className="btn btn-secondary" disabled={openingOutput} onClick={async () => {
              setOpeningOutput(true);
              try { await window.tenderAssist.openJobOutput(jobId); }
              catch (err) { setError(err instanceof Error ? err.message : String(err)); }
              finally { setOpeningOutput(false); }
            }}>{openingOutput ? 'Opening…' : 'Open output folder'}</button>
          )}
          <StatePill state={detail.jobState} />
        </div>
      </div>

      {latestUpdate?.outcome && (
        <div className={bannerClass}>
          <span><strong>{latestUpdate.outcome}</strong>{latestUpdate.abortReason ? ` — ${latestUpdate.abortReason}` : ''}</span>
        </div>
      )}

      <section className="flow-panel" aria-labelledby="flow-title">
        <div className="section-heading">
          <div>
            <h2 id="flow-title">Job flow</h2>
          </div>
          {detail.runConfiguration && <span className="flow-date">{getPortalDefinition(detail.runConfiguration.portalId).name} · Published {detail.runConfiguration.searchDate}</span>}
        </div>
        <ol className="flow-rail">
          {FLOW_STAGES.map((stage, index) => {
            const isReached = reached.has(stage.state);
            const isCurrent = detail.jobState === stage.state;
            return (
              <li className={isCurrent ? 'flow-step is-active' : isReached ? 'flow-step is-complete' : 'flow-step'} key={stage.state}>
                <span className="flow-step__number">{isReached ? '✓' : index + 1}</span>
                <span><strong>{stage.label}</strong><small>{stage.detail}</small></span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="result-summary" aria-label="Tender decision summary">
        <div><strong>{detail.tenders.length}</strong><span>Found</span></div>
        <div className="summary-keep"><strong>{shortlisted.length}</strong><span>Certain (shortlisted)</span></div>
        <div className="summary-uncertain"><strong>{uncertain.length}</strong><span>Borderline (needs review)</span></div>
        <div><strong>{rejected.length}</strong><span>Rejected</span></div>
      </div>

      {detail.jobState === 'SHORTLISTED' && (
        <section className="selection-panel" aria-labelledby="selection-title">
          <div className="section-heading">
            <div>
              <h2 id="selection-title">Choose what to download and extract</h2>
              <p>Tick the tenders to acquire documents for, run requirement extraction on, and build an eligibility sheet for. Nothing downloads until you confirm.</p>
            </div>
          </div>
          <div className="selection-panel__actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={confirmingSelection || !selectedIds || selectedIds.size === 0}
              onClick={async () => {
                if (!selectedIds) return;
                setConfirmingSelection(true);
                setSelectionError(null);
                try {
                  await window.tenderAssist.confirmDocumentSelection(jobId, Array.from(selectedIds));
                } catch (err) {
                  setSelectionError(err instanceof Error ? err.message : String(err));
                  setConfirmingSelection(false);
                }
              }}
            >
              {confirmingSelection ? 'Starting…' : `Download, extract & build eligibility sheet for ${selectedIds?.size ?? 0} tender${selectedIds?.size === 1 ? '' : 's'}`}
            </button>
            {selectionError && <p className="error-text">{selectionError}</p>}
          </div>
        </section>
      )}

      {detail.runConfiguration && (
        <details className="run-config-summary">
          <summary>Intent used for this job</summary>
          <div className="run-config-summary__grid">
            <div><h3>Product categories</h3><p>{detail.runConfiguration.productCategories.join(', ')}</p></div>
            <div><h3>Intent keywords</h3><p>{detail.runConfiguration.keywords.join(', ')}</p></div>
            <div><h3>Excluded scope</h3><p>{detail.runConfiguration.excludedKeywords.join(', ') || 'None'}</p></div>
          </div>
        </details>
      )}

      <section className="result-section">
        <div className="section-heading">
          <div><h2>Shortlist ({shortlisted.length})</h2></div>
        </div>
        {shortlisted.length > 0 ? (
          <div className="tender-card-list">{shortlisted.map((tender) => (
            <TenderCard
              tender={tender}
              onReviewed={load}
              key={tender.id}
              selectable={detail.jobState === 'SHORTLISTED'}
              selected={selectedIds?.has(tender.id) ?? false}
              onToggleSelected={(tenderId, checked) => {
                setSelectedIds((current) => {
                  const next = new Set(current ?? []);
                  if (checked) next.add(tenderId); else next.delete(tenderId);
                  return next;
                });
              }}
            />
          ))}</div>
        ) : (
          <div className="empty-panel">No tender passed every intent gate in this job.</div>
        )}
      </section>

      {uncertain.length > 0 && (
        <section className="result-section">
          <div className="section-heading">
            <div><h2>Needs review ({uncertain.length})</h2></div>
            <p>These are separated from the shortlist because a portal detail could not be verified.</p>
          </div>
          <div className="tender-card-list">{uncertain.map((tender) => (
            <TenderCard
              tender={tender}
              onReviewed={load}
              key={tender.id}
              selectable={detail.jobState === 'SHORTLISTED'}
              selected={selectedIds?.has(tender.id) ?? false}
              onToggleSelected={(tenderId, checked) => {
                setSelectedIds((current) => {
                  const next = new Set(current ?? []);
                  if (checked) next.add(tenderId); else next.delete(tenderId);
                  return next;
                });
              }}
            />
          ))}</div>
        </section>
      )}

      <details className="audit-details">
        <summary>All discovered tenders and audit history</summary>
        <div className="audit-details__body">
          <table className="data-table compact-table">
            <thead><tr><th>Tender ID</th><th>Full title</th><th>Department</th><th>State</th><th>Category</th><th>Decision</th></tr></thead>
            <tbody>
              {detail.tenders.map((tender) => (
                <tr key={tender.id}>
                  <td className="job-id">{tender.tender_portal_id ?? tender.tender_ref}</td>
                  <td>{tender.title}</td>
                  <td>{tender.department || '—'}</td>
                  <td>{tender.state_name || '—'}</td>
                  <td>{tender.detail_product_category || tender.product_category}</td>
                  <td><StatePill state={tender.effectiveClassification} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="detail-columns audit-timelines">
            <div>
              <h3>Job transitions</h3>
              <ul className="timeline">{detail.jobTransitions.map((transition) => (
                <li key={transition.id}><div className="timeline__transition">{transition.from_state ?? '(start)'} &rarr; {transition.to_state}</div><div className="timeline__reason">{transition.reason}</div><div className="timeline__time">{transition.occurred_at}</div></li>
              ))}</ul>
            </div>
            <div>
              <h3>Authentication transitions</h3>
              <ul className="timeline">{detail.authTransitions.map((transition) => (
                <li key={transition.id}><div className="timeline__transition">{transition.from_state ?? '(start)'} &rarr; {transition.to_state}</div><div className="timeline__reason">{transition.reason}</div><div className="timeline__time">{transition.occurred_at}</div></li>
              ))}</ul>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
