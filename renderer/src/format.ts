// Human-readable timestamps. Storage stays UTC ISO; formatting happens only here.

const relative = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  if (Number.isNaN(diff)) return iso;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms || unit === 'minute') return relative.format(Math.round(diff / ms), unit);
  }
  return relative.format(0, 'minute');
}

export function absoluteDateTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : absolute.format(time);
}

export type ClosingUrgency = 'overdue' | 'soon' | 'normal' | 'unknown';

/** "Closes in 3 days" with an urgency level; under 3 days counts as soon. */
export function closingLabel(closingAt: string | null, rawClosingDate: string | null, now = Date.now()): { text: string; title: string; urgency: ClosingUrgency } {
  if (!closingAt) {
    return rawClosingDate
      ? { text: `Closes ${rawClosingDate}`, title: rawClosingDate, urgency: 'unknown' }
      : { text: 'Closing date not captured', title: 'The portal list did not show a closing date', urgency: 'unknown' };
  }
  const remaining = Date.parse(closingAt) - now;
  const urgency: ClosingUrgency = remaining < 0 ? 'overdue' : remaining < 3 * 86_400_000 ? 'soon' : 'normal';
  const text = remaining < 0 ? `Closed ${relativeTime(closingAt, now)}` : `Closes ${relativeTime(closingAt, now)}`;
  return { text, title: absoluteDateTime(closingAt), urgency };
}
