import { describe, expect, it } from 'vitest';
import { matchRank, rankCategories, splitCategory } from '../../renderer/src/categorySearch.js';

const LIST = [
  'Annual Maintenance Service - Desktops, Laptops And Peripherals',
  'Software Support Services 2.0 - Microsoft; Operating System Software',
  'Hiring Of Professionals For Application Development And Maintenance - Database Related Roles',
  'Application Development',
  'Design, Development, Implementation, And Maintenance Of Websites, Web Portal - Open Source Solution (oss)',
];

describe('finding a GeM category in the picker', () => {
  it('matches the words typed in any order', () => {
    expect(matchRank(LIST[3], 'development application')).not.toBeNull();
    expect(matchRank(LIST[3], 'mobile application')).toBeNull();
  });

  it('puts names starting with what was typed first, then names containing it, then matches only in the example', () => {
    expect(rankCategories(LIST, 'application development')).toEqual([LIST[3], LIST[2]]);
    // "software" is in the name of one entry and only in the example of none here; "microsoft" only in an example.
    expect(rankCategories(LIST, 'microsoft')).toEqual([LIST[1]]);
    expect(matchRank(LIST[1], 'microsoft')).toBe(3);
    expect(rankCategories(LIST, 'web portal')).toEqual([LIST[4]]);
  });

  it('keeps GeM’s own order when nothing is typed, and drops what the caller leaves out', () => {
    expect(rankCategories(LIST, '')).toEqual(LIST);
    expect(rankCategories(LIST, '', (option) => option !== LIST[0])).toEqual(LIST.slice(1));
  });

  it('splits a long GeM entry into its name and example', () => {
    expect(splitCategory(LIST[1])).toEqual({ name: 'Software Support Services 2.0', detail: 'Microsoft; Operating System Software' });
    expect(splitCategory('Application Development')).toEqual({ name: 'Application Development', detail: '' });
  });
});
