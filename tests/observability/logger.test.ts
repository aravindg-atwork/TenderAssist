// tests/observability/logger.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from '../../src/observability/logger.js';

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits structured JSON with level, message, and fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('job started', { jobId: 'abc-123' });

    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('job started');
    expect(entry.jobId).toBe('abc-123');
    expect(typeof entry.timestamp).toBe('string');
  });

  it('redacts fields whose key looks like a secret', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.warn('dsc pin entered', { dscPin: '1234', tenderId: 'EB_704783' });

    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry.dscPin).toBe('[REDACTED]');
    expect(entry.tenderId).toBe('EB_704783');
  });
});
