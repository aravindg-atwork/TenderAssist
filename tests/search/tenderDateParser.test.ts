import { describe, it, expect } from 'vitest';
import { parseTenderPortalDate } from '../../src/search/tenderDateParser.js';

describe('parseTenderPortalDate', () => {
  it('parses a real captured PM timestamp to ISO with the +05:30 (IST) offset', () => {
    expect(parseTenderPortalDate('11-Sep-2026 06:00 PM')).toBe('2026-09-11T18:00:00+05:30');
  });

  it('parses a real captured AM timestamp', () => {
    expect(parseTenderPortalDate('29-Sep-2026 11:00 AM')).toBe('2026-09-29T11:00:00+05:30');
  });

  it('handles 12:00 PM (noon) correctly', () => {
    expect(parseTenderPortalDate('01-Oct-2026 12:00 PM')).toBe('2026-10-01T12:00:00+05:30');
  });

  it('handles 12:00 AM (midnight) correctly', () => {
    expect(parseTenderPortalDate('01-Oct-2026 12:00 AM')).toBe('2026-10-01T00:00:00+05:30');
  });

  it('returns null for unparseable input', () => {
    expect(parseTenderPortalDate('not a date')).toBeNull();
    expect(parseTenderPortalDate('')).toBeNull();
    expect(parseTenderPortalDate('2026-09-11 18:00')).toBeNull();
  });
});
