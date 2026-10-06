// A question the run asks the operator about one unsure tender, while its
// details page is still open. No answer in time means the run moves on.

/** How long the run waits for "Keep or skip?" before moving on. */
export const RUN_QUESTION_TIMEOUT_MS = 2 * 60_000;

export type RunQuestionAnswer = 'KEEP' | 'SKIP';

export interface RunQuestion {
  id: string;
  tenderTitle: string;
  tenderId: string | null;
  reference: string;
  organisation: string | null;
  category: string | null;
  closingDate: string | null;
  value: string | null;
  /** Why TenderAssist is unsure, in one plain sentence. */
  reason: string;
  /** When the run stops waiting (ISO time). */
  answerBy: string;
}

/**
 * Waits for one answer. Resolves null when nobody answers in time or the run
 * is stopped. `register` receives the function that delivers the answer.
 */
export function waitForAnswer(
  register: (deliver: ((answer: RunQuestionAnswer) => void) | undefined) => void,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<RunQuestionAnswer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: RunQuestionAnswer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      register(undefined);
      resolve(answer);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    if (signal?.aborted) return finish(null);
    signal?.addEventListener('abort', onAbort, { once: true });
    register((answer) => finish(answer));
  });
}
