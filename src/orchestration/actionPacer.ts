import type { AutomationPacingSettings } from '../persistence/repositories/automationSettingsRepository.js';

export type PaceAction = () => Promise<void>;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => done();
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function createActionPacer(settings: AutomationPacingSettings, signal?: AbortSignal): PaceAction {
  return async () => {
    const range = Math.max(0, settings.maxDelayMs - settings.minDelayMs);
    const delayMs = settings.minDelayMs + Math.round(Math.random() * range);
    await wait(delayMs, signal);
  };
}
