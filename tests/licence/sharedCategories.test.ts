import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { sharedListToApply, type SharedCategoryList } from '../../src/licence/sharedCategories.js';

interface Row { category: string; code: string; firstSeen: string; lastSeen: string; goneSince: string }
interface Merge { accepted: boolean; reason?: string; rows: Row[]; changes: Array<{ change: string; category: string }> }

// The key server's merge rule, run from Code.gs itself.
const server = (() => {
  const context: Record<string, unknown> = {};
  runInNewContext(readFileSync(join(process.cwd(), 'licence-server', 'Code.gs'), 'utf8'), context);
  return context as { mergeCategoryReport(rows: Row[], list: Array<{ name: string; code?: string }>, readAt: string): Merge };
})();

const list = (...names: string[]) => names.map((name) => ({ name }));
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('shared website categories on the key server', () => {
  it('starts a website quietly, then records what is new, gone and back', () => {
    const first = server.mergeCategoryReport([], list('Information Technology', 'Civil Works', 'Consultancy'), '2026-10-10T05:00:00.000Z');
    expect(first.accepted).toBe(true);
    expect(first.changes).toEqual([]);

    // Tamil Nadu drops "Information Technology" and adds "IT Services".
    const second = server.mergeCategoryReport(first.rows, list('IT Services', 'civil  works', 'Consultancy'), '2026-10-11T05:00:00.000Z');
    expect(plain(second.changes)).toEqual([{ change: 'New', category: 'IT Services' }, { change: 'Gone', category: 'Information Technology' }]);
    const gone = second.rows.find((row) => row.category === 'Information Technology')!;
    expect(gone.goneSince).toBe('2026-10-11T05:00:00.000Z');
    expect(second.rows.find((row) => row.category === 'civil  works'.replace(/\s+/g, ' '))!.firstSeen).toBe('2026-10-10T05:00:00.000Z');

    const third = server.mergeCategoryReport(second.rows, list('IT Services', 'Civil Works', 'Consultancy', 'Information Technology'), '2026-10-12T05:00:00.000Z');
    expect(plain(third.changes)).toEqual([{ change: 'Back', category: 'Information Technology' }]);
    expect(third.rows.find((row) => row.category === 'Information Technology')!.goneSince).toBe('');
  });

  it('ignores an older read, an empty one, and a half-loaded list', () => {
    const start = server.mergeCategoryReport([], list('A', 'B', 'C', 'D'), '2026-10-10T05:00:00.000Z').rows;
    expect(server.mergeCategoryReport(start, list('A'), '2026-10-09T05:00:00.000Z')).toMatchObject({ accepted: false, reason: 'older' });
    expect(server.mergeCategoryReport(start, [], '2026-10-11T05:00:00.000Z')).toMatchObject({ accepted: false, reason: 'empty' });
    expect(server.mergeCategoryReport(start, list('A'), '2026-10-11T05:00:00.000Z')).toMatchObject({ accepted: false, reason: 'too-short' });
  });
});

describe('taking in the shared categories on this PC', () => {
  const shared: SharedCategoryList = {
    readAt: '2026-10-12T05:00:00.000Z',
    categories: [
      { name: 'IT Services', code: 'it', firstSeen: '2026-10-11T05:00:00.000Z', lastSeen: '2026-10-12T05:00:00.000Z', goneSince: '' },
      { name: 'Information Technology', code: '', firstSeen: '2026-10-01T05:00:00.000Z', lastSeen: '2026-10-10T05:00:00.000Z', goneSince: '2026-10-11T05:00:00.000Z' },
    ],
  };

  it('takes another office’s newer read: the categories on it, with their codes', () => {
    expect(sharedListToApply({ readAt: '2026-10-09T05:00:00.000Z' }, shared))
      .toEqual({ names: ['IT Services'], codes: { 'IT Services': 'it' }, readAt: '2026-10-12T05:00:00.000Z' });
    expect(sharedListToApply({ readAt: null }, shared)?.names).toEqual(['IT Services']);
  });

  it('keeps this PC’s own list when it is as new or newer', () => {
    expect(sharedListToApply({ readAt: '2026-10-12T05:00:00.000Z' }, shared)).toBeNull();
    expect(sharedListToApply({ readAt: '2026-10-12T06:00:00.000Z' }, shared)).toBeNull();
    expect(sharedListToApply({ readAt: null }, undefined)).toBeNull();
  });
});
