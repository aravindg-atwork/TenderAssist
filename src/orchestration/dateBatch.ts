// A range of published dates is searched one date at a time, each as its
// own run, in one signed-in portal session. Dates that already have a
// completed run for the portal are skipped.

/** Longest range accepted in one go, so a mistyped year cannot queue hundreds of runs. */
export const MAX_BATCH_DAYS = 62;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value: string, label: string): Date {
  const match = ISO_DATE.exec(value);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  if (!date || Number.isNaN(date.getTime()) || formatIsoDate(date) !== value) throw new Error(`${label} is not a valid date.`);
  return date;
}

export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Every calendar date from `from` to `to`, both included, oldest first. */
export function datesInRange(from: string, to: string, today: string = formatIsoDate(new Date())): string[] {
  const start = parseIsoDate(from, 'The start date');
  const end = parseIsoDate(to, 'The end date');
  if (end < start) throw new Error('The end date is before the start date.');
  if (to > today) throw new Error('The end date is in the future. Choose today or an earlier date.');
  const dates: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(formatIsoDate(cursor));
    if (dates.length > MAX_BATCH_DAYS) throw new Error(`Choose at most ${MAX_BATCH_DAYS} days at a time.`);
  }
  return dates;
}

export interface DateBatchPlan {
  /** Dates to search, oldest first. */
  toRun: string[];
  /** Dates in the range that already have a completed run. */
  skipped: string[];
}

export function planDateBatch(from: string, to: string, completedDates: Iterable<string>, today?: string): DateBatchPlan {
  const completed = new Set(completedDates);
  const dates = datesInRange(from, to, today);
  return {
    toRun: dates.filter((date) => !completed.has(date)),
    skipped: dates.filter((date) => completed.has(date)),
  };
}

export function describeSkipped(skipped: string[]): string {
  if (skipped.length === 0) return '';
  return `${skipped.length} date${skipped.length === 1 ? ' was' : 's were'} already run and skipped: ${skipped.join(', ')}.`;
}
