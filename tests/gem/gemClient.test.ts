import { describe, expect, it } from 'vitest';
import { categoryListFrom, csrfTokenFrom, GemClient, isGemFileUrl } from '../../src/gem/gemClient.js';
import { isTransientPortalError } from '../../src/orchestration/transientRetry.js';

const LIST_PAGE = `<html><script>
  data: {'payload': JSON.stringify(postdata), 'csrf_bd_gem_nk': '9ae4d77fdfe0ae1d11a46273f9e093cb'},
</script></html>`;

const LIST_DATA = {
  status: 1, code: 200,
  response: { response: { numFound: 21, start: 0, docs: [
    { b_id: [1], b_bid_number: ['GEM/2026/B/1'], b_category_name: ['Custom Bid for Services - Portal'], final_start_date_sort: ['2026-10-06T10:00:00Z'] },
  ] } },
};

function response(body: string, init: { status?: number; headers?: Record<string, string>; url?: string } = {}): Response {
  const res = new Response(body, { status: init.status ?? 200, headers: init.headers });
  if (init.url) Object.defineProperty(res, 'url', { value: init.url });
  return res;
}

describe('GeM client', () => {
  it('opens a session, then asks for the bid list with its form token and cookie', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/all-bids')) return response(LIST_PAGE, { headers: { 'Set-Cookie': 'ci_session=abc; path=/; HttpOnly' } });
      return response(JSON.stringify(LIST_DATA), { headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const client = new GemClient({ fetch: fakeFetch });
    const page = await client.listBids({ page: 2, bidType: 'service' });

    expect(page.total).toBe(21);
    expect(page.bids.map((bid) => bid.bidNumber)).toEqual(['GEM/2026/B/1']);
    const post = calls[1];
    expect(post.url).toBe('https://bidplus.gem.gov.in/all-bids-data');
    const form = new URLSearchParams(post.init.body as string);
    expect(form.get('csrf_bd_gem_nk')).toBe('9ae4d77fdfe0ae1d11a46273f9e093cb');
    expect(JSON.parse(form.get('payload')!)).toMatchObject({ page: 2, filter: { byType: 'service', bidStatusType: 'ongoing_bids', sort: 'Bid-Start-Date-Latest' } });
    expect((post.init.headers as Record<string, string>).Cookie).toBe('ci_session=abc');
  });

  it('opens a fresh session once when GeM forgets the old one', async () => {
    let lists = 0;
    let opens = 0;
    const fakeFetch = (async (url: string) => {
      if (url.endsWith('/all-bids')) { opens += 1; return response(LIST_PAGE); }
      lists += 1;
      return lists === 1 ? response('<html>Session expired</html>') : response(JSON.stringify(LIST_DATA));
    }) as unknown as typeof fetch;
    const page = await new GemClient({ fetch: fakeFetch }).listBids({ page: 1, bidType: 'service' });
    expect(page.bids).toHaveLength(1);
    expect(opens).toBe(2);
  });

  it('reports GeM being busy (5xx) as temporary, so the run waits and tries again', async () => {
    const fakeFetch = (async () => response('busy', { status: 500 })) as unknown as typeof fetch;
    const error = await new GemClient({ fetch: fakeFetch }).listBids({ page: 1, bidType: 'service' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(isTransientPortalError(error)).toBe(true);
  });

  it('downloads only files on GeM’s own hosts', async () => {
    expect(isGemFileUrl('https://bidplus.gem.gov.in/showbidDocument/1')).toBe(true);
    expect(isGemFileUrl('https://fulfilment.gem.gov.in/contract/slafds?fileDownloadPath=a.pdf')).toBe(true);
    expect(isGemFileUrl('http://bidplus.gem.gov.in/showbidDocument/1')).toBe(false);
    expect(isGemFileUrl('https://example.com/a.pdf')).toBe(false);

    const fakeFetch = (async (url: string) => response('%PDF-1.4', { url: url.includes('redirect') ? 'https://example.com/x.pdf' : url, headers: { 'Content-Type': 'application/pdf' } })) as unknown as typeof fetch;
    const client = new GemClient({ fetch: fakeFetch });
    await expect(client.fetchFile('https://example.com/a.pdf')).rejects.toThrow(/not on a GeM website/);
    await expect(client.fetchFile('https://bidplus.gem.gov.in/redirect/1')).rejects.toThrow(/outside GeM/);
    const file = await client.fetchFile('https://bidplus.gem.gov.in/showbidDocument/1');
    expect(file.body.toString()).toBe('%PDF-1.4');
  });

  it('reads the form token and the category list from GeM’s pages', () => {
    expect(csrfTokenFrom(LIST_PAGE)).toBe('9ae4d77fdfe0ae1d11a46273f9e093cb');
    const html = `<select class="form-control select2" name="category" id="categorybid">
      <option value="">--Select--</option>
      <option value="services_home_cust" >Custom Bid For Services</option>
      <option value="services_home_fa1" >Facility Management Services - Lumpsum Based - Government Sugar Mill</option>
      <option value="services_home_fa2" >Facility Management Services - Lumpsum Based - Other</option>
      <option value="home_appa_clot_hang" >Hangers - Clothes</option>
      <option value="services_home_m" >Monthly Basis Cab &amp; Taxi Hiring Services - Suv</option>
    </select>`;
    // Exactly as GeM shows them, in GeM's order, each with its code.
    expect(categoryListFrom(html)).toEqual({
      services: [
        { name: 'Custom Bid For Services', code: 'services_home_cust' },
        { name: 'Facility Management Services - Lumpsum Based - Government Sugar Mill', code: 'services_home_fa1' },
        { name: 'Facility Management Services - Lumpsum Based - Other', code: 'services_home_fa2' },
        { name: 'Monthly Basis Cab & Taxi Hiring Services - Suv', code: 'services_home_m' },
      ],
      products: [{ name: 'Hangers - Clothes', code: 'home_appa_clot_hang' }],
    });
  });
});
