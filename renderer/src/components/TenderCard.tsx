import type { TenderSummary } from '../../../src/electron/ipcTypes';
import { getPortalDefinition, isGemPortal } from '../../../src/config/portalRegistry';
import { ClockIcon } from './icons';
import { Tracking } from './Tracking';

const DAY = 86_400_000;

/** "GeM", "TN", "MH": a short mark for the website a tender came from. */
export function portalMark(portalId: string): string {
  const portal = getPortalDefinition(portalId);
  if (isGemPortal(portal)) return 'GeM';
  const words = portal.name.replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((word) => word[0]).join('') : portal.name.slice(0, 2)).slice(0, 3).toUpperCase();
}

/** "561600" -> ₹5.62 L; values in crore and lakh read the way the office says them. */
export function compactRupees(value: string | null): { short: string; full: string } | null {
  if (!value || value === 'NA') return null;
  const amount = Number(value.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const full = `₹${amount.toLocaleString('en-IN')}`;
  if (amount >= 1e7) return { short: `₹${(amount / 1e7).toFixed(2)} Cr`, full };
  if (amount >= 1e5) return { short: `₹${(amount / 1e5).toFixed(2)} L`, full };
  return { short: full, full };
}

export type Urgency = 'calm' | 'week' | 'soon' | 'today' | 'closed' | 'unknown';

/** Time left to bid, as words and a colour that warms as the deadline nears. */
export function deadline(closingAt: string | null, publishedDate: string | null, now = Date.now()): {
  urgency: Urgency; left: string; elapsed: number | null;
} {
  if (!closingAt) return { urgency: 'unknown', left: 'No closing date', elapsed: null };
  const close = Date.parse(closingAt);
  const remaining = close - now;
  const published = publishedDate ? Date.parse(publishedDate.length <= 10 ? `${publishedDate}T00:00:00` : publishedDate) : NaN;
  const elapsed = Number.isFinite(published) && close > published ? Math.min(1, Math.max(0, (now - published) / (close - published))) : null;
  if (remaining <= 0) return { urgency: 'closed', left: 'Closed', elapsed: 1 };
  const hours = Math.floor(remaining / 3_600_000);
  if (remaining < DAY) return { urgency: 'today', left: hours < 1 ? 'Under an hour left' : `${hours} h left`, elapsed };
  const days = Math.floor(remaining / DAY);
  const left = `${days} ${days === 1 ? 'day' : 'days'} left`;
  return { urgency: days < 3 ? 'soon' : days < 7 ? 'week' : 'calm', left, elapsed };
}

/**
 * One tender as a card: the facts in fixed places, the time left as a chip
 * that warms towards the deadline, the bidding period as a bar, and the
 * status along the bottom. The whole card opens the tender.
 */
export function TenderCard({ tender, onOpen }: { tender: TenderSummary; onOpen: () => void }) {
  const time = deadline(tender.closingAt, tender.publishedDate);
  const value = compactRupees(tender.value);
  const department = tender.department || tender.organisation?.split('||')[0] || null;
  return (
    <li className={`tcard tcard--${time.urgency}`}>
      <button type="button" className="tcard__main" onClick={onOpen} aria-label={`Open ${tender.title}`}>
        <span className="tcard__mark" aria-hidden="true">{portalMark(tender.portalId)}</span>
        <span className="tcard__head">
          <span className="tcard__title">{tender.title}</span>
          <span className="tcard__dept">{department ?? 'Department not stated'}</span>
        </span>
        <span className="tcard__fact">
          <strong title={value?.full}>{value?.short ?? 'Not stated'}</strong>
          <small>Value</small>
        </span>
        <span className={`tcard__clock tcard__clock--${time.urgency}`}><ClockIcon /> {time.left}</span>
      </button>
      <span className="tcard__foot">
        <Tracking tender={tender} compact />
        <span className="tcard__meta">{tender.tenderId}</span>
      </span>
    </li>
  );
}
