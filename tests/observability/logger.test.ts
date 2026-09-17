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

  it('redacts a secret key nested inside an object field', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Uses a non-secret container key ("context") so this actually exercises the
    // recursive redaction path, rather than being trivially caught by the
    // top-level "session"/"auth"-style keyword match.
    logger.warn('x', { context: { password: '1234' } });

    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry.context.password).toBe('[REDACTED]');
  });

  it('redacts an entire secret-keyed field even when its value is an object', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.warn('x', { session: { password: '1234' } });

    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry.session).toBe('[REDACTED]');
  });

  it('preserves a non-secret nested field', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('x', { profile: { name: 'jane' } });

    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry.profile.name).toBe('jane');
  });

  it('does not let caller-supplied fields overwrite the log envelope', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.error('failed', { message: 'other', level: 'debug' });

    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('failed');
  });
});
