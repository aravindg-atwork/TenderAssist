import { describe, expect, it } from 'vitest';
import { chosenOrganisationOf, DEFAULT_RUN_DEFAULTS, familyOfWord, normalizeIntentFamilies,normalizeFromTime, normalizeRunConfiguration, normalizeRunDefaults, organisationsForPortal, publishedBeforeFromTime } from '../../src/config/runConfiguration.js';

const base = { searchDate: '2026-10-27', portalId: 'tamil-nadu', productCategories: ['IT'], keywords: ['software'], excludedKeywords: [] };

describe('searching a day from a time', () => {
  it('reads a time of day as HH:MM, and midnight or nothing as the whole day', () => {
    expect(normalizeFromTime('9:05')).toBe('09:05');
    expect(normalizeFromTime(' 10:30 ')).toBe('10:30');
    expect(normalizeFromTime('00:00')).toBeUndefined();
    expect(normalizeFromTime('')).toBeUndefined();
    expect(normalizeFromTime(undefined)).toBeUndefined();
    expect(() => normalizeFromTime('25:00')).toThrow(/like 10:30/);
    expect(() => normalizeFromTime('ten')).toThrow(/like 10:30/);
  });

  it('keeps the time only on a published-day search', () => {
    expect(normalizeRunConfiguration({ ...base, fromTime: '10:04' }).fromTime).toBe('10:04');
    expect(normalizeRunConfiguration({ ...base, portalId: 'gem', dateMeaning: 'CLOSING', fromTime: '10:04' }).fromTime).toBeUndefined();
    expect('fromTime' in normalizeRunConfiguration(base)).toBe(false);
  });

  it('leaves out a tender published before the time, in Indian time, and never one with no time', () => {
    expect(publishedBeforeFromTime('2026-10-27T09:59:00+05:30', '10:04')).toBe(true);
    expect(publishedBeforeFromTime('2026-10-27T10:04:00+05:30', '10:04')).toBe(false);
    // GeM's start times are Indian wall-clock times without an offset.
    expect(publishedBeforeFromTime('2026-10-27T15:10:00', '10:04')).toBe(false);
    expect(publishedBeforeFromTime(null, '10:04')).toBe(false);
    expect(publishedBeforeFromTime('2026-10-27T09:00:00+05:30', undefined)).toBe(false);
  });
});

describe('organisations to search', () => {
  it('finds the chosen organisation in a Tamil Nadu chain or GeM’s ministry and department, ignoring case and punctuation', () => {
    expect(chosenOrganisationOf(['Tamil Nadu Electricity Board||Chief Engineer IT'], ['tamil nadu electricity board'])).toBe('tamil nadu electricity board');
    expect(chosenOrganisationOf(['Ministry of Railways', 'Indian Railways - Zonal'], ['Indian Railways'])).toBe('Indian Railways');
    expect(chosenOrganisationOf(['Ministry of Home Affairs', 'Central Reserve Police Force'], ['Police'])).toBeNull();
    expect(chosenOrganisationOf(['Department of Science & Technology'], ['Department of Science and Technology'])).toBe('Department of Science and Technology');
    expect(chosenOrganisationOf([null, undefined], ['Anything'])).toBeNull();
    expect(chosenOrganisationOf(['Anything'], undefined)).toBeNull();
  });

  it('keeps each website’s list apart, and a run carries its own', () => {
    const defaults = normalizeRunDefaults({ ...DEFAULT_RUN_DEFAULTS, organisationsByPortal: { 'tamil-nadu': [' TNEB ', 'tneb'], gem: [] } });
    expect(defaults.organisationsByPortal).toEqual({ 'tamil-nadu': ['TNEB'] });
    expect(organisationsForPortal(defaults, { id: 'gem' })).toEqual([]);
    expect(normalizeRunConfiguration({ ...base, organisations: ['TNEB'] }).organisations).toEqual(['TNEB']);
    expect('organisations' in normalizeRunConfiguration(base)).toBe(false);
  });
});

describe('word families', () => {
  it('adds every family phrase to the intent words, so runs match them with no change', () => {
    const defaults = normalizeRunDefaults({
      ...DEFAULT_RUN_DEFAULTS,
      keywords: ['software development'],
      intentFamilies: [{ name: ' Websites ', phrases: ['web portal', 'Web Portal', 'website development'] }],
    });
    expect(defaults.intentFamilies).toEqual([{ name: 'Websites', phrases: ['web portal', 'website development'] }]);
    expect(defaults.keywords).toEqual(['software development', 'web portal', 'website development']);
  });

  it('keeps each name and each phrase once, and an empty family until it is filled', () => {
    const families = normalizeIntentFamilies([
      { name: 'Mobile apps', phrases: ['mobile app'] },
      { name: 'mobile apps', phrases: ['android app'] },
      { name: 'Apps', phrases: ['mobile app', 'ios application'] },
      { name: '', phrases: ['lost'] },
      { name: 'E-learning', phrases: [] },
      'junk',
    ]);
    expect(families).toEqual([
      { name: 'Mobile apps', phrases: ['mobile app'] },
      { name: 'Apps', phrases: ['ios application'] },
      { name: 'E-learning', phrases: [] },
    ]);
  });

  it('leaves settings saved before families as they were', () => {
    const defaults = normalizeRunDefaults({ ...DEFAULT_RUN_DEFAULTS, keywords: ['website development'] });
    expect('intentFamilies' in defaults).toBe(false);
    expect(defaults.keywords).toEqual(['website development']);
    expect(normalizeIntentFamilies(undefined)).toEqual([]);
  });

  it('names the family of an intent word', () => {
    const families = [{ name: 'Websites', phrases: ['Web Portal'] }];
    expect(familyOfWord('web  portal', families)).toBe('Websites');
    expect(familyOfWord('mobile app', families)).toBeNull();
    expect(familyOfWord('web portal', undefined)).toBeNull();
  });
});
