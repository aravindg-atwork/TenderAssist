import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { SearchRepository } from '../../src/persistence/repositories/searchRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { ClassificationRepository } from '../../src/persistence/repositories/classificationRepository.js';
import { JobStateMachine } from '../../src/state/jobStateMachine.js';
import { bidFromTender, inChosenCategory, runGemDate, type GemRunDeps } from '../../src/gem/gemRunner.js';
import type { GemBid } from '../../src/gem/gemBid.js';
import type { RunConfiguration } from '../../src/config/runConfiguration.js';
import { BID_TEXT } from './bidTextFixture.js';

function bid(id: number, title: string, startsAt = '2026-10-06T11:00:00'): GemBid {
  const category = title.split(' - ')[0];
  return {
    id: String(id), bidNumber: `GEM/2026/B/${id}`, kind: 'BID', title, itemName: title, category, categoryCode: null,
    ministry: 'Ministry of Electronics and Information Technology', department: 'NIC', startsAt, endsAt: '2026-10-20T15:00:00',
    quantity: 1, parentBidNumber: null, cancelled: false, highValue: false, rateContract: false, globalTender: false,
  };
}

const CONFIG: RunConfiguration = {
  searchDate: '2026-10-06',
  portalId: 'gem',
  productCategories: ['Custom Bid For Services', 'Application Development'],
  keywords: ['web application', 'mobile application'],
  excludedKeywords: ['laptop'],
};

describe('a GeM run for one date', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let jobMachine: JobStateMachine;
  let tenders: TenderRepository;
  let classifications: ClassificationRepository;
  let searches: SearchRepository;
  let jobId: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    jobMachine = new JobStateMachine(db, jobs, new StateTransitionRepository(db));
    tenders = new TenderRepository(db);
    classifications = new ClassificationRepository(db);
    searches = new SearchRepository(db);
    jobId = jobs.create().id;
    for (const state of ['AUTH_REQUIRED', 'AUTH_PENDING', 'AUTHENTICATED'] as const) jobMachine.transition(jobId, state, 'test setup');
  });

  function deps(bids: GemBid[], pdfText: Record<string, string>, extra: Partial<GemRunDeps> = {}): GemRunDeps {
    return {
      jobs, jobMachine, searches, tenders, classifications, includeProducts: false, retryDelaysMs: [], secondTryDelayMs: 0,
      client: {
        listBids: async ({ page }) => ({ total: bids.length, bids: bids.slice((page - 1) * 10, page * 10) }),
        fetchFile: async (url) => ({ finalUrl: url, contentType: 'application/pdf', body: Buffer.from(`%PDF-${url.split('/').pop()}`) }),
      },
      readPdf: async (data) => {
        const id = Buffer.from(data).toString().replace('%PDF-', '');
        return { text: pdfText[id] ?? '', links: [`https://bidplus.gem.gov.in/resources/upload_nas/OctQ426/bidding/biddoc/bid-${id}/1789541628.pdf`] };
      },
      ...extra,
    };
  }

  const finalFor = (ref: string) => classifications.getFinalForTender(tenders.findByJobAndRef(jobId, ref)!.id);

  it('keeps bids in your categories that mention an intent word, and rejects the rest without reading them', async () => {
    const bids = [
      bid(1, 'Custom Bid for Services - Development of web application for citizen services'),
      bid(2, 'Manpower Outsourcing Services - Fixed Remuneration - Admin'),
      bid(3, 'Custom Bid for Services - Supply of laptop and web application'),
      bid(4, 'Custom Bid for Services - Hiring of vehicles'),
      bid(5, 'Custom Bid for Services - Web application for the old day', '2026-10-05T18:00:00'),
    ];
    const read: string[] = [];
    const run = deps(bids, { 1: BID_TEXT, 4: BID_TEXT });
    const readPdf = run.readPdf!;
    run.readPdf = async (data) => { read.push(Buffer.from(data).toString()); return readPdf(data); };
    const result = await runGemDate(run, jobId, CONFIG, () => {});

    expect(result.outcome).toBe('SUCCESS');
    expect(jobs.getById(jobId)!.state).toBe('SHORTLISTED');
    expect(tenders.listForJob(jobId).map((tender) => tender.tender_ref).sort()).toEqual(['GEM/2026/B/1', 'GEM/2026/B/2', 'GEM/2026/B/3', 'GEM/2026/B/4']);
    expect(finalFor('GEM/2026/B/1')).toBe('KEEP');
    expect(finalFor('GEM/2026/B/2')).toBe('REJECT'); // not in your categories
    expect(finalFor('GEM/2026/B/3')).toBe('REJECT'); // excluded word in the title
    expect(finalFor('GEM/2026/B/4')).toBe('REJECT'); // read, no intent word
    // Only bids in your categories without an excluded word are read.
    expect(read.map((value) => value.replace('%PDF-', '')).sort()).toEqual(['1', '4']);
  });

  it('records the bid’s facts for the eligibility sheet and lists its files to save', async () => {
    await runGemDate(deps([bid(1, 'Custom Bid for Services - Development of web application')], { 1: BID_TEXT }), jobId, CONFIG, () => {});
    const tender = tenders.findByJobAndRef(jobId, 'GEM/2026/B/1')!;
    expect(tender.closing_date).toBe('07-Oct-2026 12:00 PM');
    expect(tender.value_in_rupees).toBe('1,06,25,689.63');
    expect(tender.detail_text).toContain('EMD Amount in ₹: 3,18,771');
    expect(tender.detail_text).toContain('Bid Submission End Date: 07-10-2026 12:00:00');
    expect(tender.detail_text).toContain('Pre-Qualification: minimum average annual turnover 212.51 Lakh (s); 3 Year (s) of past experience');
    expect(JSON.parse(tender.document_links_json)).toEqual([
      { url: 'https://bidplus.gem.gov.in/showbidDocument/1', fileName: 'GeM bid GEM-2026-B-1.pdf' },
      { url: 'https://bidplus.gem.gov.in/resources/upload_nas/OctQ426/bidding/biddoc/bid-1/1789541628.pdf', fileName: 'Scope of work.pdf' },
    ]);
  });

  it('asks the operator when only the bid document mentions an intent word', async () => {
    const asked: Array<{ reason: string; url: string }> = [];
    const text = `${BID_TEXT.split('/Disclaimer')[0]} Scope: build a mobile application for field staff.`;
    await runGemDate(deps([bid(7, 'Custom Bid for Services - Field staff tracking')], { 7: text }, {
      askOperator: async (_tender, reason, url) => { asked.push({ reason, url }); return 'SKIP'; },
    }), jobId, CONFIG, () => {});
    expect(asked).toHaveLength(1);
    expect(asked[0].reason).toContain('mobile application');
    expect(asked[0].url).toBe('https://bidplus.gem.gov.in/showbidDocument/7');
  });

  it('needs the whole phrase in the bid document, not its words scattered through it', async () => {
    const text = `${BID_TEXT.split('/Disclaimer')[0]} Contact: Mobile no 9876543210. Bidder application form as per ATC.`;
    await runGemDate(deps([bid(9, 'Custom Bid for Services - Repair of distribution transformer')], { 9: text }), jobId, CONFIG, () => {});
    expect(finalFor('GEM/2026/B/9')).toBe('REJECT');
  });

  it('leaves a bid whose PDF cannot be read for the operator, with the PDF still listed to save', async () => {
    const run = deps([bid(8, 'Custom Bid for Services - Web application')], {});
    run.client.fetchFile = async () => { throw new Error('GeM returned HTTP 404.'); };
    await runGemDate(run, jobId, CONFIG, () => {});
    expect(finalFor('GEM/2026/B/8')).toBe('UNCERTAIN');
    expect(tenders.findByJobAndRef(jobId, 'GEM/2026/B/8')!.document_links_json).toContain('showbidDocument/8');
  });

  it('tries a bid document GeM did not send once more at the end, and decides it normally', async () => {
    const run = deps([bid(11, 'Custom Bid for Services - Development of web application')], { 11: BID_TEXT }, { secondTryDelayMs: 0 });
    const fetchFile = run.client.fetchFile;
    let calls = 0;
    run.client.fetchFile = async (url) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('GeM returned HTTP 500.'), { name: 'TimeoutError' });
      return fetchFile(url);
    };
    const messages: string[] = [];
    await runGemDate(run, jobId, CONFIG, (update) => { if (update.statusMessage) messages.push(update.statusMessage); });
    expect(calls).toBe(2);
    expect(finalFor('GEM/2026/B/11')).toBe('KEEP');
    expect(messages.some((message) => /trying it again/.test(message))).toBe(true);
  });

  it('stops cleanly when the bid list cannot be read at all', async () => {
    const run = deps([], {});
    run.client.listBids = async () => { throw new Error('GeM could not be reached.'); };
    const result = await runGemDate(run, jobId, CONFIG, () => {});
    expect(result.outcome).toBe('ABORTED');
    expect(jobs.getById(jobId)!.state).toBe('FAILED_RETRYABLE');
  });

  it('matches GeM’s dropdown entries by GeM’s own code, as GeM’s search does', async () => {
    const codes = new Map([
      ['custom bid for services', 'services_home_cust'],
      ['application development', 'services_home_appl'],
    ]);
    const shown = { ...bid(10, 'Custom Bid for Services - Portal'), categoryCode: 'services_home_cust' };
    expect(inChosenCategory(shown, 'Custom Bid For Services', codes)).toBe(true);
    // A bid for several items carries several codes.
    expect(inChosenCategory({ category: 'Bus Hiring Service', categoryCode: 'services_home_bus,services_home_appl' }, 'Application Development', codes)).toBe(true);
    expect(inChosenCategory({ category: 'Application Development', categoryCode: 'services_home_other' }, 'Application Development', codes)).toBe(false);
    // Without GeM's list, the name before " - " is compared.
    expect(inChosenCategory({ category: 'Facility Management Services', categoryCode: 'x' }, 'Facility Management Services - Lumpsum Based - Other')).toBe(true);
  });

  it('rebuilds a bid from a saved tender, to read its PDF again later', () => {
    const saved = tenders.upsert({
      jobId, tenderRef: 'GEM/2026/R/746323', tenderPortalId: '9983631', title: 'Custom Bid for Services - X',
      organisationChain: 'Ministry of Home Affairs||Department of Home', publishedDate: '2026-10-06T11:00:00+05:30',
      closingDate: null, openingDate: null, productCategory: 'Custom Bid for Services', valueInRupees: '',
    });
    expect(bidFromTender(saved)).toMatchObject({ id: '9983631', kind: 'RA', ministry: 'Ministry of Home Affairs', startsAt: '2026-10-06T11:00:00' });
  });
});
