import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionPacer } from '../../src/orchestration/actionPacer.js';

describe('createActionPacer', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns immediately in Fast mode', async () => {
    vi.useFakeTimers();
    const pace = createActionPacer({ mode: 'FAST', minDelayMs: 0, maxDelayMs: 0 });
    await expect(pace()).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses a delay inside the configured range', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const pace = createActionPacer({ mode: 'CUSTOM', minDelayMs: 2_000, maxDelayMs: 4_000 });
    let settled = false;
    const pending = pace().then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it('stops waiting when the job is cancelled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pace = createActionPacer(
      { mode: 'HUMAN', minDelayMs: 5_000, maxDelayMs: 5_000 },
      controller.signal
    );
    const pending = pace();
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
