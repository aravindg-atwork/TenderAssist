import { describe, expect, it, vi } from 'vitest';
import { waitForAnswer, type RunQuestionAnswer } from '../../src/orchestration/runQuestion.js';
import { withRunState } from '../../src/orchestration/runQuestion.js';

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

describe('the run update the screen receives', () => {
  const question = {
    id: 'q1', tenderTitle: 'Comprehensive Safety Audit', tenderId: '1', reference: 'GEM/2026/B/1', organisation: null,
    category: null, closingDate: null, value: null, reason: 'Only in its details.', answerBy: new Date().toISOString(),
  };

  it('always carries the open question, even when copied from an update made before it was asked', () => {
    // An earlier update, stored with an empty question, is re-sent with a new message.
    const earlier = { jobId: 'j', statusMessage: 'Reading bid 4 of 9', question: undefined };
    const sent = withRunState({ ...earlier, statusMessage: 'Waiting for your answer' }, { question, searchDate: '2026-10-07' });
    expect(sent.question).toBe(question);
    expect(sent.statusMessage).toBe('Waiting for your answer');
    expect(sent.searchDate).toBe('2026-10-07');
  });

  it('carries no question once it is answered, whatever the copied update said', () => {
    expect(withRunState({ jobId: 'j', question }, { question: undefined }).question).toBeUndefined();
  });
});
