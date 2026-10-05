// Plain words for internal states. Nothing like FAILED_MANUAL or
// AUTH_PENDING ever reaches the screen.

export type RunTone = 'done' | 'stopped' | 'problem' | 'working';

export function runStatus(jobState: string, isActive: boolean): { text: string; tone: RunTone } {
  if (jobState === 'COMPLETE') return { text: 'Finished', tone: 'done' };
  if (jobState === 'CANCELLED') return { text: 'Stopped', tone: 'stopped' };
  if (jobState === 'FAILED_MANUAL') return { text: 'Did not finish', tone: 'problem' };
  if (isActive) return { text: 'Running now', tone: 'working' };
  return { text: 'Interrupted', tone: 'problem' };
}

export function publishedLabel(iso: string | null): string {
  if (!iso) return 'Date not recorded';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
