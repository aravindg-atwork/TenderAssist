import { describe, expect, it, vi } from 'vitest';
import { waitForAnswer, type RunQuestionAnswer } from '../../src/orchestration/runQuestion.js';

describe('waitForAnswer', () => {
  it('returns the operator answer and stops listening', async () => {
    let deliver: ((answer: RunQuestionAnswer) => void) | undefined;
    const waiting = waitForAnswer((fn) => { deliver = fn; }, 60_000);
    deliver!('KEEP');
    await expect(waiting).resolves.toBe('KEEP');
    expect(deliver).toBeUndefined();
  });

  it('returns null when nobody answers in time', async () => {
    vi.useFakeTimers();
    try {
      let deliver: ((answer: RunQuestionAnswer) => void) | undefined;
      const waiting = waitForAnswer((fn) => { deliver = fn; }, 120_000);
      vi.advanceTimersByTime(120_000);
      await expect(waiting).resolves.toBeNull();
      expect(deliver).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null at once when the run is stopped', async () => {
    const controller = new AbortController();
    const waiting = waitForAnswer(() => {}, 120_000, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBeNull();
  });
});
