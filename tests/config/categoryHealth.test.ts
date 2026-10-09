import { describe, expect, it } from 'vitest';
import { categoryHealth, mergeCategoryHistory, suggestReplacements, type CategoryHealthInput } from '../../src/config/categoryHealth.js';

const DAY1 = '2026-10-08T04:00:00.000Z';
const DAY2 = '2026-10-09T03:48:00.000Z';

function twoReads(): CategoryHealthInput {
  const first = ['Computer- S/W', 'Information Technology', 'Info. Tech. Services', 'Civil Works'];
  const second = ['Computer- S/W', 'Info. Tech. Services', 'Civil Works', 'IT Services and Solutions'];
  const history = mergeCategoryHistory(mergeCategoryHistory(undefined, first, DAY1), second, DAY2);
  return { categories: second, readAt: DAY2, history, historySince: DAY1, newLookedAt: null };
}

describe('category history', () => {
  it('keeps the first sighting and moves the last one forward', () => {
    const history = mergeCategoryHistory(mergeCategoryHistory(undefined, ['Computer- S/W'], DAY1), [' computer-  s/w '], DAY2);
    expect(history['computer- s/w']).toEqual({ firstSeen: DAY1, lastSeen: DAY2 });
  });
});

describe('categoryHealth', () => {
  it('names a chosen category the website dropped, with when it was last listed, and keeps it', () => {
    const health = categoryHealth(twoReads(), ['Computer- S/W', 'Information Technology'], new Date('2026-10-09T10:00:00Z'));
    expect(health.missing).toEqual([{ name: 'Information Technology', lastSeen: DAY1, longGone: false }]);
  });

  it('suggests removing a category only after two weeks off the list', () => {
    const health = categoryHealth(twoReads(), ['Information Technology'], new Date('2026-10-22T05:00:00Z'));
    expect(health.missing[0].longGone).toBe(true);
  });

  it('counts a category never seen from when the history began', () => {
    const list = { ...twoReads(), history: mergeCategoryHistory(undefined, twoReads().categories, DAY2), historySince: DAY2 };
    expect(categoryHealth(list, ['Documentary film'], new Date('2026-10-10T00:00:00Z')).missing[0]).toEqual({ name: 'Documentary film', lastSeen: null, longGone: false });
  });

  it('lists categories new since the first read, not the whole first list, and not chosen ones', () => {
    expect(categoryHealth(twoReads(), ['Computer- S/W']).newOnWebsite).toEqual(['IT Services and Solutions']);
    expect(categoryHealth(twoReads(), ['IT Services and Solutions']).newOnWebsite).toEqual([]);
    expect(categoryHealth({ ...twoReads(), newLookedAt: '2026-10-09T05:00:00.000Z' }, []).newOnWebsite).toEqual([]);
  });

  it('says nothing before the website list was read', () => {
    expect(categoryHealth({ categories: [], readAt: null }, ['Information Technology'])).toEqual({ readAt: null, missing: [], newOnWebsite: [] });
  });
});

describe('suggestReplacements', () => {
  it('puts where wanted tenders were listed before new and similar names', () => {
    const advice = suggestReplacements(twoReads(), 'Information Technology', ['Computer- S/W', 'Information Technology'], [
      { category: 'Information Technology', detailCategory: 'Civil Works', wanted: true },
      { category: 'Information Technology', detailCategory: null, wanted: false },
      { category: 'Computer- S/W', detailCategory: null, wanted: true },
    ]);
    expect(advice.missing).toEqual({ name: 'Information Technology', found: 2, wanted: 1 });
    expect(advice.suggestions.map((item) => item.name)).toEqual(['Civil Works', 'IT Services and Solutions', 'Info. Tech. Services']);
    expect(advice.suggestions[0].reasons[0]).toBe('1 tender you wanted was listed here');
    expect(advice.suggestions[1].reasons).toContain('New on the website since it went: may be its new name');
    expect(advice.suggestions[2].reasons).toEqual(['Similar name']);
  });

  it('never suggests a category already chosen', () => {
    const advice = suggestReplacements(twoReads(), 'Information Technology', ['Info. Tech. Services'], []);
    expect(advice.suggestions.map((item) => item.name)).not.toContain('Info. Tech. Services');
  });
});
