// Bounded retries for read-only portal steps (search, opening a tender,
// opening My Tenders). Only failures that look temporary are retried, and
// never an action that changes something on the portal or needs the
// operator (sign-in, DSC, favouriting, document downloads).

const TRANSIENT_MESSAGE = /timeout|timed out|net::ERR_(?:TIMED_OUT|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_REFUSED|NETWORK_CHANGED|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|EMPTY_RESPONSE|ABORTED)|ECONNRESET|ETIMEDOUT|socket hang up|HTTP 50[234]/i;

export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000];

export function isTransientPortalError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (/has been closed|Target closed/i.test(error.message)) return false;
  return error.name === 'TimeoutError' || TRANSIENT_MESSAGE.test(error.message);
}

/** Plain wording for a recorded portal error; the raw message stays available for diagnostics. */
export function describePortalError(message: string): string {
  return isTransientPortalError(Object.assign(new Error(message), { name: /timeout/i.test(message) ? 'TimeoutError' : 'Error' }))
    ? 'The portal did not respond in time.'
    : message;
}

export interface RetryOptions {
  /** Pause before each retry; its length sets how many retries are made. */
  delaysMs?: readonly number[];
  /** Checked before each retry, e.g. the run was cancelled or signed out. */
  canRetry?: () => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
  signal?: AbortSignal;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Run `step`, retrying transient failures. The thrown error carries `attempts`. */
export async function retryTransient<T>(step: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await step();
    } catch (error) {
      const retryable = attempt <= delays.length && isTransientPortalError(error) && (options.canRetry?.() ?? true) && !options.signal?.aborted;
      if (!retryable) {
        if (error instanceof Error) Object.assign(error, { attempts: attempt });
        throw error;
      }
      options.onRetry?.(attempt, error);
      await pause(delays[attempt - 1], options.signal);
    }
  }
}
