import { describe, expect, it } from 'vitest';
import { datesInRange, MAX_BATCH_DAYS, planDateBatch } from '../../src/orchestration/dateBatch.js';

describe('date batches', () => {
  it('lists each published date in the range, both ends included', () => {
    expect(datesInRange('2026-09-29', '2026-10-02', '2026-10-05')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(datesInRange('2026-10-05', '2026-10-05', '2026-10-05')).toEqual(['2026-10-05']);
  });

  it('crosses month and year ends', () => {
    expect(datesInRange('2025-12-31', '2026-01-01', '2026-10-05')).toEqual(['2025-12-31', '2026-01-01']);
    expect(datesInRange('2028-02-28', '2028-03-01', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('rejects reversed, future, invalid, and oversized ranges', () => {
    expect(() => datesInRange('2026-10-02', '2026-10-01', '2026-10-05')).toThrow(/before the start/);
    expect(() => datesInRange('2026-10-01', '2026-10-06', '2026-10-05')).toThrow(/future/);
    expect(() => datesInRange('2026-02-30', '2026-03-01', '2026-10-05')).toThrow(/not a valid date/);
    expect(() => datesInRange('2026-01-01', '2026-10-05', '2026-10-05')).toThrow(new RegExp(`at most ${MAX_BATCH_DAYS}`));
  });

  it('skips dates that already have a completed run', () => {
    expect(planDateBatch('2026-09-10', '2026-09-13', ['2026-09-11', '2026-08-01'], '2026-10-05')).toEqual({
      toRun: ['2026-09-10', '2026-09-12', '2026-09-13'],
      skipped: ['2026-09-11'],
    });
  });
});
