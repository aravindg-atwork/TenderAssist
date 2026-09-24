import { useEffect, useRef, useState } from 'react';
import type { TenderDetailItem } from '../../../src/electron/ipcTypes';
import { defaultSelection, selectionCandidates } from '../../../src/ui/shortlistSelection';

export interface LiveShortlistProps {
  jobId: string;
}

/**
 * The tender choice inside the live run, beside the signed-in portal.
 * Nothing downloads until the operator confirms; the portal stays signed in
 * while they decide.
 */
export function LiveShortlist({ jobId }: LiveShortlistProps) {
  const [tenders, setTenders] = useState<TenderDetailItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let current = true;
    window.tenderAssist.getJobDetail(jobId).then((detail) => {
      if (!current) return;
      const candidates = selectionCandidates(detail.tenders);
      setTenders(candidates);
      setSelected(defaultSelection(candidates));
    }).catch((err) => current && setError(err instanceof Error ? err.message : String(err)));
    return () => { current = false; };
  }, [jobId]);

  // The choice is the operator's next action; bring it into view below the progress steps.
  useEffect(() => {
    if (tenders) sectionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [tenders]);

  const toggle = (id: string, checked: boolean) => setSelected((previous) => {
    const next = new Set(previous);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });

  const confirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      await window.tenderAssist.confirmDocumentSelection(jobId, [...selected]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirming(false);
    }
  };

  if (!tenders) return <p className="live-shortlist__loading">{error ?? 'Loading the shortlist…'}</p>;

  const groups = [
    { title: 'Shortlisted', items: tenders.filter((tender) => tender.effectiveClassification === 'KEEP') },
    { title: 'Needs your review', items: tenders.filter((tender) => tender.effectiveClassification === 'UNCERTAIN') },
  ].filter((group) => group.items.length > 0);

  return (
    <section ref={sectionRef} className="live-shortlist" aria-labelledby="live-shortlist-title">
      <h2 id="live-shortlist-title">Choose tenders to download</h2>
      {groups.length === 0 ? (
        <p>No tender passed screening in this run. Confirm to finish the run and create the report.</p>
      ) : groups.map((group) => (
        <fieldset key={group.title} className="live-shortlist__group">
          <legend>{group.title} ({group.items.length})</legend>
          {group.items.map((tender) => (
            <label key={tender.id} className="live-shortlist__item">
              <input type="checkbox" checked={selected.has(tender.id)} onChange={(event) => toggle(tender.id, event.target.checked)} />
              <span>
                <strong>{tender.title}</strong>
                <small>{[tender.tender_portal_id ?? tender.tender_ref, tender.closing_date && `closes ${tender.closing_date}`].filter(Boolean).join(' · ')}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      <button className="btn btn-primary live-shortlist__confirm" type="button" onClick={confirm} disabled={confirming}>
        {confirming ? 'Starting…' : selected.size === 0 ? 'Finish without downloading' : `Download documents for ${selected.size} tender${selected.size === 1 ? '' : 's'}`}
      </button>
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
