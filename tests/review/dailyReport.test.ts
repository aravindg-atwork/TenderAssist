import { describe, expect, it } from 'vitest';
import { buildDailyReport, datesBetween, type ReportRun } from '../../src/review/dailyReport.js';
import { parseOrganisations, parsePublishedDates, publishedDay } from '../../src/portal/publicTenderCounts.js';

const run = (date: string, at: string, tenders: ReportRun['tenders'], categoriesSearched = ['Computer- S/W', 'Miscellaneous Services']): ReportRun =>
  ({ date, at, finished: true, categoriesSearched, tenders });

describe('buildDailyReport', () => {
  const runs = [
    run('2026-10-08', '2026-10-08T04:00:00Z', [
      { key: 'A', category: 'Miscellaneous Services', verdict: 'REJECT', approved: false, inCategory: true },
      { key: 'B', category: 'Computer- S/W', verdict: 'UNCERTAIN', approved: false, inCategory: true },
    ]),
    // The same day searched again: B was kept this time, and C is new.
    run('2026-10-08', '2026-10-08T09:00:00Z', [
      { key: 'B', category: 'Computer- S/W', verdict: 'KEEP', approved: true, inCategory: true },
      { key: 'C', category: 'Miscellaneous Services', verdict: 'KEEP', approved: false, inCategory: true },
    ]),
  ];
  const counts = [{ date: '2026-10-08', total: 469, categories: null, readAt: '2026-10-09T06:00:00Z' }, { date: '2026-10-07', total: 419, categories: null, readAt: '2026-10-09T06:00:00Z' }];
  const report = buildDailyReport('2026-10-06', '2026-10-08', runs, counts);

  it('counts each tender once per day, with its latest verdict, newest day first', () => {
    expect(report.days.map((day) => day.date)).toEqual(['2026-10-08', '2026-10-07', '2026-10-06']);
    expect(report.days[0]).toMatchObject({ weekday: 'Thu', onWebsite: 469, searched: true, found: 3, shortlisted: 2, unsure: 0, rejected: 1, approved: 1 });
  });

  it('splits a day by category, listing searched categories even with nothing found', () => {
    expect(report.days[0].categories).toEqual([
      { category: 'Miscellaneous Services', onWebsite: null, found: 2, shortlisted: 1, approved: 0 },
      { category: 'Computer- S/W', onWebsite: null, found: 1, shortlisted: 1, approved: 1 },
    ]);
  });

  it('shows a day not searched with the website total only, and averages over days with tenders', () => {
    expect(report.days[1]).toMatchObject({ onWebsite: 419, searched: false, found: 0 });
    expect(report.totals).toEqual({ onWebsite: 888, found: 3, shortlisted: 2, unsure: 0, rejected: 1, approved: 1 });
    expect(report.averages).toEqual({ onWebsite: 444, found: 1.5, shortlisted: 1, workingDays: 2 });
  });

  it('takes GeM category totals for the whole website', () => {
    const gem = buildDailyReport('2026-10-09', '2026-10-09',
      [run('2026-10-09', '2026-10-09T04:00:00Z', [{ key: 'G1', category: 'Application Development', verdict: 'KEEP', approved: false, inCategory: true }], [])],
      [{ date: '2026-10-09', total: 131, categories: { 'Application Development': 4, 'Handling Service': 30 }, readAt: '2026-10-09T04:30:00Z' }]);
    expect(gem.days[0].categories).toEqual([{ category: 'Application Development', onWebsite: 4, found: 1, shortlisted: 1, approved: 0 }]);
  });

  it('for a GeM run that listed every bid: the website total is all bids, "in your categories" only yours', () => {
    const bids = [
      { key: 'G1', category: 'Application Development', verdict: 'KEEP' as const, approved: false, inCategory: true },
      { key: 'G2', category: 'Handling Service', verdict: 'REJECT' as const, approved: false, inCategory: false },
      { key: 'G3', category: 'Repair and Overhauling Service', verdict: 'REJECT' as const, approved: false, inCategory: false },
      { key: 'G4', category: 'Comprehensive AMC', verdict: 'KEEP' as const, approved: true, inCategory: false },
    ];
    const gem = buildDailyReport('2026-10-09', '2026-10-09', [{ ...run('2026-10-09', '2026-10-09T04:00:00Z', bids, []), listsWholeWebsite: true }], []);
    expect(gem.days[0]).toMatchObject({ onWebsite: 4, found: 1, shortlisted: 2, rejected: 2, approved: 1 });
    expect(gem.days[0].categories).toEqual([
      { category: 'Application Development', onWebsite: 1, found: 1, shortlisted: 1, approved: 0 },
      { category: 'Comprehensive AMC', onWebsite: 1, found: 0, shortlisted: 1, approved: 1 },
      { category: 'Other categories', onWebsite: 2, found: 0, shortlisted: 0, approved: 0 },
    ]);
  });

  it('lists every calendar day in a range', () => {
    expect(datesBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });
});

describe('public tender counts (GePNIC "Tenders by Organisation")', () => {
  const orgPage = `<table><tr><td>S.No</td><td>Organisation Name</td><td>Tender Count</td></tr>
    <tr><td>1</td><td>Anna University Chennai</td><td align="right"><a id="DirectLink" class="link2" href="/nicgep/app?component=%24DirectLink&amp;page=FrontEndTendersByOrganisation&amp;service=direct&amp;session=T&amp;sp=S1">  1  </a></td></tr>
    <tr><td>2</td><td>CMWSS Board</td><td align="right"><a id="DirectLink_0" class="link2" href="/nicgep/app?component=%24DirectLink_0&amp;sp=S2">9</a></td></tr></table>`;
  const listPage = `<table><tr><td>S.No</td><td>e-Published Date</td><td>Closing Date</td><td>Opening Date</td><td></td><td>Title and Ref.No./Tender ID</td><td>Organisation Chain</td></tr>
    <tr><td>1</td><td>08-Oct-2026 06:50 PM</td><td>27-Oct-2026 03:00 PM</td><td>28-Oct-2026 03:00 PM</td><td></td><td>[Outsourcing of O&amp;M] [CNT/SEW][2026_CMWSS_712218_1]</td><td>CMWSS Board</td></tr>
    <tr><td>2</td><td>05-Oct-2026 12:55 PM</td><td>22-Oct-2026 03:00 PM</td><td>23-Oct-2026 03:00 PM</td><td></td><td>[Water main] [CNT/WSS][2026_CMWSS_709851_1]</td><td>CMWSS Board</td></tr></table>`;

  it('reads the organisations, their counts and links', () => {
    expect(parseOrganisations(orgPage)).toEqual([
      { name: 'Anna University Chennai', count: 1, href: '/nicgep/app?component=%24DirectLink&page=FrontEndTendersByOrganisation&service=direct&session=T&sp=S1' },
      { name: 'CMWSS Board', count: 9, href: '/nicgep/app?component=%24DirectLink_0&sp=S2' },
    ]);
  });

  it('reads each tender\'s published day', () => {
    expect(parsePublishedDates(listPage)).toEqual(['2026-10-08', '2026-10-05']);
    expect(publishedDay('01-Oct-2026 10:30 AM')).toBe('2026-10-01');
  });
});
