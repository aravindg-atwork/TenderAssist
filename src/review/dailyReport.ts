// The daily report: for each published day, how many tenders the website
// published, how many were in the office's categories, how many TenderAssist
// shortlisted, and how that splits by category. A day searched more than
// once counts each tender once (by Tender ID), with its latest verdict.

export type Verdict = 'KEEP' | 'UNCERTAIN' | 'REJECT' | 'NOT_RUN';

export interface ReportTender {
  /** Tender ID (or reference): the same tender in two runs counts once. */
  key: string;
  category: string;
  verdict: Verdict;
  approved: boolean;
  /** In one of the office's chosen categories (always, for a website searched category by category). */
  inCategory: boolean;
}

export interface ReportRun {
  /** Published date searched, YYYY-MM-DD. */
  date: string;
  /** When the run was made; later runs give the latest verdict. */
  at: string;
  finished: boolean;
  categoriesSearched: string[];
  tenders: ReportTender[];
  /** The run listed every tender the website published that day (GeM), not only the chosen categories. */
  listsWholeWebsite?: boolean;
}

export interface ReportDayCount {
  date: string;
  total: number;
  categories: Record<string, number> | null;
  readAt: string;
}

export interface CategoryRow {
  category: string;
  /** Across the whole website that day, when the website gives categories (GeM). */
  onWebsite: number | null;
  found: number;
  shortlisted: number;
  approved: number;
}

export interface DayRow {
  date: string;
  weekday: string;
  /** Published on the website that day (all categories); null when not read. */
  onWebsite: number | null;
  onWebsiteReadAt: string | null;
  searched: boolean;
  found: number;
  shortlisted: number;
  unsure: number;
  rejected: number;
  approved: number;
  categories: CategoryRow[];
}

export interface DailyReport {
  days: DayRow[];
  totals: { onWebsite: number; found: number; shortlisted: number; unsure: number; rejected: number; approved: number };
  /** Averages per day with tenders (a day the website published anything, or a searched day). */
  averages: { onWebsite: number | null; found: number; shortlisted: number; workingDays: number };
  categories: CategoryRow[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const day = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (day <= end && out.length < 400) {
    out.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}

function addCategory(map: Map<string, CategoryRow>, category: string): CategoryRow {
  let row = map.get(category);
  if (!row) { row = { category, onWebsite: null, found: 0, shortlisted: 0, approved: 0 }; map.set(category, row); }
  return row;
}

export function buildDailyReport(from: string, to: string, runs: ReportRun[], counts: ReportDayCount[]): DailyReport {
  const countFor = new Map(counts.map((count) => [count.date, count]));
  const days: DayRow[] = datesBetween(from, to).reverse().map((date) => {
    const dayRuns = runs.filter((run) => run.date === date).sort((a, b) => a.at.localeCompare(b.at));
    const latest = new Map<string, ReportTender>();
    for (const run of dayRuns) for (const tender of run.tenders) latest.set(tender.key, tender);
    const tenders = [...latest.values()];
    const wholeWebsite = dayRuns.some((run) => run.listsWholeWebsite && run.finished);
    const categories = new Map<string, CategoryRow>();
    for (const run of dayRuns) for (const category of run.categoriesSearched) addCategory(categories, category);
    // Categories that are not the office's and gave it nothing: one "Other categories" line.
    const other: CategoryRow = { category: 'Other categories', onWebsite: wholeWebsite ? 0 : null, found: 0, shortlisted: 0, approved: 0 };
    const nameOf = (tender: ReportTender) => tender.category || 'Not stated';
    const listedIn = new Map<string, number>();
    for (const tender of tenders) listedIn.set(nameOf(tender), (listedIn.get(nameOf(tender)) ?? 0) + 1);
    for (const tender of tenders) {
      const relevant = tender.inCategory || tender.verdict === 'KEEP' || tender.approved;
      if (!relevant && !categories.has(nameOf(tender))) {
        if (other.onWebsite !== null) other.onWebsite += 1;
        continue;
      }
      const row = addCategory(categories, nameOf(tender));
      if (tender.inCategory) row.found += 1;
      if (tender.verdict === 'KEEP') row.shortlisted += 1;
      if (tender.approved) row.approved += 1;
    }
    const count = countFor.get(date);
    for (const row of categories.values()) {
      row.onWebsite = count?.categories?.[row.category] ?? (wholeWebsite ? listedIn.get(row.category) ?? 0 : null);
    }
    return {
      date,
      weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()],
      onWebsite: count?.total ?? (wholeWebsite ? tenders.length : null),
      onWebsiteReadAt: count?.readAt ?? null,
      searched: dayRuns.some((run) => run.finished),
      found: tenders.filter((tender) => tender.inCategory).length,
      shortlisted: tenders.filter((tender) => tender.verdict === 'KEEP').length,
      unsure: tenders.filter((tender) => tender.verdict === 'UNCERTAIN').length,
      rejected: tenders.filter((tender) => tender.verdict === 'REJECT').length,
      approved: tenders.filter((tender) => tender.approved).length,
      categories: [
        ...[...categories.values()].sort((a, b) => b.found - a.found || b.shortlisted - a.shortlisted || a.category.localeCompare(b.category)),
        ...(other.onWebsite ? [other] : []),
      ],
    };
  });

  const sum = (pick: (day: DayRow) => number) => days.reduce((total, day) => total + pick(day), 0);
  const working = days.filter((day) => (day.onWebsite ?? 0) > 0 || day.found > 0);
  const withTotals = working.filter((day) => day.onWebsite !== null);
  const perDay = (value: number, n: number) => (n === 0 ? 0 : Math.round((value / n) * 10) / 10);
  const allCategories = new Map<string, CategoryRow>();
  for (const day of days) {
    for (const row of day.categories) {
      const total = addCategory(allCategories, row.category);
      total.found += row.found;
      total.shortlisted += row.shortlisted;
      total.approved += row.approved;
      if (row.onWebsite !== null) total.onWebsite = (total.onWebsite ?? 0) + row.onWebsite;
    }
  }
  return {
    days,
    totals: {
      onWebsite: sum((day) => day.onWebsite ?? 0),
      found: sum((day) => day.found),
      shortlisted: sum((day) => day.shortlisted),
      unsure: sum((day) => day.unsure),
      rejected: sum((day) => day.rejected),
      approved: sum((day) => day.approved),
    },
    averages: {
      onWebsite: withTotals.length > 0 ? perDay(withTotals.reduce((total, day) => total + (day.onWebsite ?? 0), 0), withTotals.length) : null,
      found: perDay(working.reduce((total, day) => total + day.found, 0), working.length),
      shortlisted: perDay(working.reduce((total, day) => total + day.shortlisted, 0), working.length),
      workingDays: working.length,
    },
    categories: [...allCategories.values()].sort((a, b) => b.found - a.found || a.category.localeCompare(b.category)),
  };
}
