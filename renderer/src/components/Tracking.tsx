import type { TenderSummary } from '../../../src/electron/ipcTypes';
import { CheckIcon } from './icons';

export type Tone = 'done' | 'keep' | 'look' | 'reject' | 'later' | 'now' | 'todo';
interface Stage { label: string; tone: Tone; when?: string | null }

const dayMonth = (iso: string | null | undefined) => {
  if (!iso) return null;
  const date = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const FILED = new Set(['DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'PREPARING', 'SUBMITTED', 'NOT_SUBMITTED', 'WON', 'LOST']);
const DECIDED: Record<string, { label: string; tone: Tone }> = {
  APPROVED: { label: 'Approved', tone: 'keep' },
  DOCUMENTS_COLLECTED: { label: 'Approved', tone: 'keep' },
  ELIGIBILITY_REVIEWED: { label: 'Approved', tone: 'keep' },
  PREPARING: { label: 'Approved', tone: 'keep' },
  SUBMITTED: { label: 'Approved', tone: 'keep' },
  NOT_SUBMITTED: { label: 'Approved', tone: 'keep' },
  WON: { label: 'Approved', tone: 'keep' },
  LOST: { label: 'Approved', tone: 'keep' },
  REJECTED: { label: 'Rejected', tone: 'reject' },
  DEFERRED: { label: 'Later', tone: 'later' },
  EXPIRED: { label: 'Closed', tone: 'todo' },
  CANCELLED: { label: 'Cancelled', tone: 'todo' },
};

/** Where a tender is on its way, Speed Post style: Found, Read, Checked, You, Filed. */
export function stagesFor(tender: TenderSummary): Stage[] {
  const read = tender.recommendation !== null;
  const checked: Stage = tender.recommendation === 'KEEP' ? { label: 'Kept', tone: 'keep' }
    : tender.recommendation === 'UNCERTAIN' ? { label: 'Unsure', tone: 'look' }
      : tender.recommendation === 'REJECT' ? { label: 'Rule says no', tone: 'reject' }
        : { label: 'Checked', tone: 'todo' };
  const decided = DECIDED[tender.lifecycle];
  const you: Stage = decided ?? { label: 'You decide', tone: read ? 'now' : 'todo' };
  const filed: Stage = FILED.has(tender.lifecycle) ? { label: 'Files saved', tone: 'done' } : { label: 'Files saved', tone: 'todo' };
  const screened = read ? dayMonth(tender.screenedAt) : null;
  return [
    { label: 'Found', tone: 'done', when: dayMonth(tender.publishedDate) },
    { label: 'Read', tone: read ? 'done' : 'now', when: screened },
    { ...checked, when: screened },
    you,
    filed,
  ];
}

/** The tracking strip: dots joined by a line that fills as the tender moves along. */
export function Tracking({ tender, compact = false }: { tender: TenderSummary; compact?: boolean }) {
  const stages = stagesFor(tender);
  const reached = stages.reduce((last, stage, index) => (stage.tone !== 'todo' && stage.tone !== 'now' ? index : last), 0);
  return (
    <ol className={compact ? 'track track--compact' : 'track'} aria-label="Where this tender is">
      {stages.map((stage, index) => (
        <li key={index} className={`track__stop track__stop--${stage.tone}${index <= reached ? ' is-reached' : ''}`}
          aria-current={stage.tone === 'now' ? 'step' : undefined}>
          <span className="track__dot" aria-hidden="true">{stage.tone !== 'todo' && stage.tone !== 'now' && <CheckIcon />}</span>
          <span className="track__label">{stage.label}</span>
          {!compact && stage.when && <span className="track__when">{stage.when}</span>}
        </li>
      ))}
    </ol>
  );
}

/** The same strip for anything with its own stops, such as a run. */
export function Stops({ stops, label }: { stops: Array<{ label: string; tone: Tone }>; label: string }) {
  const reached = stops.reduce((last, stop, index) => (stop.tone !== 'todo' && stop.tone !== 'now' ? index : last), 0);
  return (
    <ol className="track track--compact" style={{ gridTemplateColumns: `repeat(${stops.length}, minmax(0, 1fr))` }} aria-label={label}>
      {stops.map((stop, index) => (
        <li key={index} className={`track__stop track__stop--${stop.tone}${index <= reached ? ' is-reached' : ''}`}>
          <span className="track__dot" aria-hidden="true">{stop.tone !== 'todo' && stop.tone !== 'now' && <CheckIcon />}</span>
          <span className="track__label">{stop.label}</span>
        </li>
      ))}
    </ol>
  );
}
