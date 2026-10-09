import { PORTAL_CHECK_HEADERS } from '../system/preflight.js';

// How many tenders a GePNIC website (Tamil Nadu and the other NIC sites)
// published on each day, read from its public "Tenders by Organisation"
// pages: no sign-in, no CAPTCHA. Each organisation's page lists all its open
// tenders on one page with their e-Published date (checked on Tamil Nadu,
// 9 Oct 2026: 64 organisations, 5,248 tenders, every count matched).
// Closed tenders drop off the list, so older days come out lower.

export interface PublicCounts {
  /** Tenders still open, per e-Published date (YYYY-MM-DD). */
  byDate: Map<string, number>;
  organisations: number;
  tenders: number;
}

export interface CountOptions {
  fetch?: typeof fetch;
  /** Waits between page requests, so the website is not hit quickly. */
  pause?: () => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

const cells = (row: string) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
  .map((cell) => cell[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
const rows = (html: string) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);

/** "08-Oct-2026 06:50 PM" → "2026-10-08". */
export function publishedDay(raw: string): string | null {
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})/.exec(raw.trim());
  const month = match && MONTHS[match[2].toLowerCase()];
  return match && month ? `${match[3]}-${month}-${match[1]}` : null;
}

/** The organisations and the link to each one's tender list. */
export function parseOrganisations(html: string): Array<{ name: string; count: number; href: string }> {
  return rows(html).flatMap((row) => {
    const values = cells(row);
    const href = /href="([^"]*DirectLink[^"]*)"/.exec(row)?.[1]?.replace(/&amp;/g, '&');
    return values.length === 3 && /^\d+$/.test(values[0]) && /^\d+$/.test(values[2]) && href
      ? [{ name: values[1], count: Number(values[2]), href }] : [];
  });
}

/** The e-Published dates of an organisation's tender list. */
export function parsePublishedDates(html: string): string[] {
  return rows(html).flatMap((row) => {
    const values = cells(row);
    if (values.length < 6 || !/^\d+\.?$/.test(values[0])) return [];
    const day = publishedDay(values[1]);
    return day ? [day] : [];
  });
}

export async function countPublishedTenders(portalUrl: string, options: CountOptions = {}): Promise<PublicCounts> {
  const doFetch = options.fetch ?? fetch;
  const origin = new URL(portalUrl).origin;
  let cookie = '';
  const get = async (url: string): Promise<string> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await doFetch(url, { headers: { ...PORTAL_CHECK_HEADERS, ...(cookie ? { cookie } : {}) }, signal: options.signal ?? AbortSignal.timeout(60_000) });
        const set = response.headers.getSetCookie?.() ?? [];
        // The organisation links work only in the session that showed them.
        if (set.length > 0) cookie = set.map((value) => value.split(';')[0]).join('; ');
        if (!response.ok) throw new Error(`The website answered ${response.status}.`);
        return await response.text();
      } catch (error) {
        if (attempt >= 3 || options.signal?.aborted) throw error;
        await new Promise((resolve) => setTimeout(resolve, 4_000 * attempt));
      }
    }
  };
  const organisations = parseOrganisations(await get(`${portalUrl}?page=FrontEndTendersByOrganisation&service=page`));
  if (organisations.length === 0) throw new Error('The website showed no organisations; its public list may have changed.');
  const byDate = new Map<string, number>();
  let tenders = 0;
  for (const [index, organisation] of organisations.entries()) {
    await options.pause?.();
    const dates = parsePublishedDates(await get(new URL(organisation.href, origin).toString()));
    for (const day of dates) byDate.set(day, (byDate.get(day) ?? 0) + 1);
    tenders += dates.length;
    options.onProgress?.(index + 1, organisations.length);
  }
  return { byDate, organisations: organisations.length, tenders };
}
