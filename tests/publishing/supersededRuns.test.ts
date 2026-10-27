import { describe, expect, it } from 'vitest';
import { laterSearches, supersededRuns, type DayFolderRun } from '../../src/publishing/supersededRuns.js';

const run = (jobId: string, runNumber: number, extra: Partial<DayFolderRun> = {}): DayFolderRun => ({
  jobId, runNumber, portalId: 'gem', searchKey: '2026-10-14 PUBLISHED', finished: true, isSearch: true, ...extra,
});

describe('searching a date again', () => {
  it('replaces the earlier finished search of the same date and website', () => {
    expect([...supersededRuns([run('first', 1), run('second', 2)])]).toEqual(['first']);
  });

  it('keeps the earlier search while the new one has not finished', () => {
    expect(supersededRuns([run('first', 1), run('second', 2, { finished: false })]).size).toBe(0);
  });

  it('also retires an earlier search that never finished', () => {
    expect([...supersededRuns([run('stopped', 1, { finished: false }), run('second', 2)])]).toEqual(['stopped']);
  });

  it('never lets one website, or another kind of search, replace another', () => {
    const runs = [
      run('gem', 1),
      run('tamil-nadu', 2, { portalId: 'tamil-nadu' }),
      run('catch-up', 3, { searchKey: '2026-10-14 CLOSING_AFTER 2026-10-20' }),
    ];
    expect(supersededRuns(runs).size).toBe(0);
  });

  it('never counts a documents or change-check run as a search', () => {
    expect(supersededRuns([run('first', 1), run('documents', 2, { isSearch: false })]).size).toBe(0);
  });
});

describe('the later searches that can replace a tender', () => {
  it('are the finished searches after it of the same date and website', () => {
    const runs = [run('first', 1), run('second', 2), run('third', 3, { finished: false }), run('tn', 4, { portalId: 'tamil-nadu' }), run('docs', 5, { isSearch: false })];
    expect(laterSearches(runs, 'first')).toEqual(['second']);
    expect(laterSearches(runs, 'second')).toEqual([]);
  });

  it('are none for a run that is not a search', () => {
    expect(laterSearches([run('docs', 1, { isSearch: false }), run('second', 2)], 'docs')).toEqual([]);
  });
});
