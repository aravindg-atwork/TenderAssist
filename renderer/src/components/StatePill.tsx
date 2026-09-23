const SUCCESS_STATES = new Set(['AUTHENTICATED', 'SHORTLISTED', 'COMPLETE', 'SUCCESS', 'KEEP']);
const ERROR_STATES = new Set([
  'SESSION_EXPIRED',
  'TAB_LOST',
  'FAILED_RETRYABLE',
  'FAILED_MANUAL',
  'ABORTED',
  'REJECT',
]);

function pillVariant(state: string): 'success' | 'error' | 'pending' | 'neutral' {
  if (state === 'CANCELLED') return 'neutral';
  if (SUCCESS_STATES.has(state)) return 'success';
  if (ERROR_STATES.has(state)) return 'error';
  return 'pending';
}

export interface StatePillProps {
  state: string | null;
}

export function StatePill({ state }: StatePillProps) {
  if (!state) return <span className="pill pill-neutral">—</span>;
  return <span className={`pill pill-${pillVariant(state)}`}>{state}</span>;
}
