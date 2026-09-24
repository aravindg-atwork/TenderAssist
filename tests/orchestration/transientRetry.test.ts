import { describe, expect, it } from 'vitest';
import { describePortalError, isTransientPortalError, retryTransient } from '../../src/orchestration/transientRetry.js';

const timeout = () => Object.assign(new Error('page.goto: Timeout 30000ms exceeded.'), { name: 'TimeoutError' });

describe('isTransientPortalError', () => {
  it('treats timeouts and dropped connections as transient', () => {
    expect(isTransientPortalError(timeout())).toBe(true);
    expect(isTransientPortalError(new Error('net::ERR_CONNECTION_RESET at https://tntenders.gov.in'))).toBe(true);
    expect(isTransientPortalError(new Error('Portal returned HTTP 503.'))).toBe(true);
  });

  it('does not retry page-structure surprises or a closed portal', () => {
    expect(isTransientPortalError(new Error('Could not find the search results table'))).toBe(false);
    expect(isTransientPortalError(new Error('Target page, context or browser has been closed'))).toBe(false);
  });
});

describe('describePortalError', () => {
  it('words timeouts plainly and keeps other messages', () => {
    expect(describePortalError('page.click: Timeout 30000ms exceeded.')).toBe('The portal did not respond in time.');
    expect(describePortalError('Search form is missing the category list')).toBe('Search form is missing the category list');
  });
});

describe('retryTransient', () => {
  it('retries a transient failure and returns the eventual result', async () => {
    let calls = 0;
    const retries: number[] = [];
    const result = await retryTransient(async () => {
      calls += 1;
      if (calls < 3) throw timeout();
      return 'rows';
    }, { delaysMs: [0, 0], onRetry: (attempt) => retries.push(attempt) });
    expect(result).toBe('rows');
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it('gives up after the last attempt and reports how many were made', async () => {
    let calls = 0;
    await expect(retryTransient(async () => { calls += 1; throw timeout(); }, { delaysMs: [0, 0] }))
      .rejects.toMatchObject({ name: 'TimeoutError', attempts: 3 });
    expect(calls).toBe(3);
  });

  it('does not retry a permanent failure', async () => {
    let calls = 0;
    await expect(retryTransient(async () => { calls += 1; throw new Error('Could not find the table'); }, { delaysMs: [0, 0] }))
      .rejects.toMatchObject({ attempts: 1 });
    expect(calls).toBe(1);
  });

  it('stops retrying when the run can no longer continue', async () => {
    let calls = 0;
    await expect(retryTransient(async () => { calls += 1; throw timeout(); }, { delaysMs: [0, 0], canRetry: () => false }))
      .rejects.toThrow('Timeout');
    expect(calls).toBe(1);
  });
});
