// Talks to GeM's public bid pages over plain HTTPS, the way its own pages do.
// No sign-in: GeM only wants the session cookie and form token that its
// bid list page hands every visitor. See docs/gem-portal.md.

import { parseGemBid, type GemBid, type GemListDoc } from './gemBid.js';

export const GEM_BID_ORIGIN = 'https://bidplus.gem.gov.in';
const LIST_PAGE = `${GEM_BID_ORIGIN}/all-bids`;
const LIST_DATA = `${GEM_BID_ORIGIN}/all-bids-data`;
const ADVANCED_SEARCH_PAGE = `${GEM_BID_ORIGIN}/advance-search`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) TenderAssist';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** Hosts whose files a GeM bid links to and TenderAssist may download. */
const FILE_HOSTS = ['bidplus.gem.gov.in', 'fulfilment.gem.gov.in'];

export type GemBidType = 'service' | 'product' | 'all';
export type GemSort = 'Bid-Start-Date-Latest' | 'Bid-Start-Date-Oldest' | 'Bid-End-Date-Latest' | 'Bid-End-Date-Oldest';

export interface GemListPage {
  /** Bids on this page, ten at most. */
  bids: GemBid[];
  /** Every bid matching the search, across all pages. */
  total: number;
}

export interface GemFile {
  finalUrl: string;
  contentType: string;
  body: Buffer;
}

export interface GemCategoryList {
  services: GemCategory[];
  products: GemCategory[];
}

export interface GemClientOptions {
  fetch?: typeof fetch;
  /** Stops every request when the run is cancelled. */
  signal?: AbortSignal;
  /** Waits before each request, so GeM is not hit too quickly. */
  pause?: () => Promise<void>;
  timeoutMs?: number;
}

export class GemRequestError extends Error {}

/** GeM answers 5xx when busy or when asked too quickly; the run waits and tries again. */
function httpError(message: string, status: number): GemRequestError {
  const error = new GemRequestError(message);
  if (status >= 500 || status === 429) error.name = 'TimeoutError';
  return error;
}

/** Whether a URL is a GeM file TenderAssist may download (HTTPS on GeM's own hosts). */
export function isGemFileUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && FILE_HOSTS.includes(url.hostname.toLocaleLowerCase());
  } catch {
    return false;
  }
}

/** GeM's form token, printed in its pages as `'csrf_bd_gem_nk': '…'`. */
export function csrfTokenFrom(html: string): string | null {
  return /csrf_bd_gem_nk['"]?\s*[:=]\s*['"]([0-9a-f]{16,})['"]/i.exec(html)?.[1] ?? null;
}

const decodeHtml = (value: string) => value
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export interface GemCategory {
  /** As GeM's Category dropdown shows it, spaces tidied. */
  name: string;
  /** GeM's code for it; bids carry the same code. */
  code: string;
}

/**
 * GeM's Category dropdown on its advanced search page, entry for entry in
 * GeM's own order. Codes starting `services_` are services; the rest are
 * products.
 */
export function categoryListFrom(html: string): GemCategoryList {
  const start = html.indexOf('id="categorybid"');
  if (start < 0) return { services: [], products: [] };
  const end = html.indexOf('</select>', start);
  const select = html.slice(start, end < 0 ? undefined : end);
  const services: GemCategory[] = [];
  const products: GemCategory[] = [];
  const seen = new Set<string>();
  for (const match of select.matchAll(/<option\s+value="([^"]+)"[^>]*>([^<]*)</g)) {
    const name = decodeHtml(match[2]).replace(/\s+/g, ' ').trim();
    const code = match[1].trim();
    if (!name || !code || seen.has(name.toLocaleLowerCase())) continue;
    seen.add(name.toLocaleLowerCase());
    (code.startsWith('services_') ? services : products).push({ name, code });
  }
  return { services, products };
}

export class GemClient {
  private readonly fetchImpl: typeof fetch;
  private readonly cookies = new Map<string, string>();
  private token: string | null = null;

  constructor(private readonly options: GemClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** One page of bids, newest start first unless another order is asked. */
  async listBids(query: { page: number; bidType: GemBidType; sort?: GemSort }): Promise<GemListPage> {
    const payload = {
      page: query.page,
      param: { searchBid: '' },
      filter: {
        bidStatusType: 'ongoing_bids',
        byType: query.bidType,
        highBidValue: '',
        byEndDate: { from: '', to: '' },
        sort: query.sort ?? 'Bid-Start-Date-Latest',
      },
    };
    // A session GeM has forgotten answers with something other than the bid
    // list; open a fresh one once before giving up.
    for (let attempt = 0; ; attempt += 1) {
      if (!this.token) await this.openSession();
      const response = await this.request(LIST_DATA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: LIST_PAGE },
        body: new URLSearchParams({ payload: JSON.stringify(payload), csrf_bd_gem_nk: this.token! }).toString(),
      });
      const parsed = await response.json().catch(() => null) as
        { code?: number; response?: { response?: { numFound?: number; docs?: GemListDoc[] } } } | null;
      const result = parsed?.code === 200 ? parsed.response?.response : undefined;
      if (response.ok && result && Array.isArray(result.docs)) {
        return {
          total: typeof result.numFound === 'number' ? result.numFound : 0,
          bids: result.docs.map(parseGemBid).filter((bid): bid is GemBid => bid !== null),
        };
      }
      this.token = null;
      if (attempt >= 1) throw httpError(`GeM did not return the bid list (HTTP ${response.status}).`, response.status);
    }
  }

  /** Downloads a file a bid links to, such as its bid PDF or an attachment. */
  async fetchFile(url: string): Promise<GemFile> {
    if (!isGemFileUrl(url)) throw new GemRequestError('The file is not on a GeM website, so it was not downloaded.');
    const response = await this.request(url, { method: 'GET', headers: { Referer: LIST_PAGE } });
    if (!response.ok) throw httpError(`GeM returned HTTP ${response.status}.`, response.status);
    const finalUrl = response.url || url;
    if (!isGemFileUrl(finalUrl)) throw new GemRequestError('GeM sent the download somewhere outside GeM, so it was not saved.');
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0 || body.length > MAX_FILE_BYTES) throw new GemRequestError('The file is empty or larger than the 100 MB safety limit.');
    return { finalUrl, contentType: response.headers.get('content-type') ?? '', body };
  }

  /** GeM's category list, from its advanced search page. */
  async categoryList(): Promise<GemCategoryList> {
    const response = await this.request(ADVANCED_SEARCH_PAGE, { method: 'GET' });
    if (!response.ok) throw new GemRequestError(`GeM returned HTTP ${response.status} for its category list.`);
    return categoryListFrom(await response.text());
  }

  private async openSession(): Promise<void> {
    this.cookies.clear();
    const response = await this.request(LIST_PAGE, { method: 'GET' });
    const html = await response.text();
    this.token = csrfTokenFrom(html) ?? this.cookies.get('csrf_gem_cookie') ?? null;
    if (!response.ok || !this.token) throw httpError(`GeM's bid list page did not open (HTTP ${response.status}).`, response.status);
  }

  private async request(url: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<Response> {
    await this.options.pause?.();
    if (this.options.signal?.aborted) throw this.options.signal.reason ?? new Error('Cancelled.');
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = this.options.signal ? AbortSignal.any([this.options.signal, timeout]) : timeout;
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: '*/*', ...init.headers };
    if (this.cookies.size > 0 && new URL(url).hostname.endsWith('gem.gov.in')) {
      headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: init.method, headers, body: init.body, signal, redirect: 'follow' });
    } catch (error) {
      if (this.options.signal?.aborted) throw error;
      const reason = timeout.aborted ? 'did not answer in time' : 'could not be reached';
      // Both are usually temporary, so the run's retries treat them like a timeout.
      const failure = new GemRequestError(`GeM ${reason}${error instanceof Error && !timeout.aborted ? ` (${error.message})` : ''}.`);
      failure.name = 'TimeoutError';
      throw failure;
    }
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const pair = /^([^=;\s]+)=([^;]*)/.exec(cookie);
      if (pair) this.cookies.set(pair[1], pair[2]);
    }
    return response;
  }
}
