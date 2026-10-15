// One GeM search date, from the bid list to a decision on every bid: no
// sign-in, no browser. Bids are found by start date (or, for a closing-date
// run, by end date), screened on their
// category and title, and the ones in your categories are read from their
// bid PDF. Documents are saved afterwards by the shared post-processing step.

import type { JobRepository } from '../persistence/repositories/jobRepository.js';
import type { SearchRepository } from '../persistence/repositories/searchRepository.js';
import type { TenderRepository, TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { ClassificationRepository } from '../persistence/repositories/classificationRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';
import type { RunConfiguration } from '../config/runConfiguration.js';
import { gemCategoryKey } from '../config/categoryHealth.js';
import type { AuthJobUpdate } from '../orchestration/authJobRunner.js';
import type { RunQuestionAnswer } from '../orchestration/runQuestion.js';
import { evaluateExcludedScope, evaluateIntentKeywords, evaluateTenderIntent, type TextGateResult } from '../classification/intentGates.js';
import { unsureReason } from '../orchestration/classificationPhaseRunner.js';
import { isCancellationRequested, markJobCancelled, USER_CANCELLED_REASON } from '../orchestration/jobCancellation.js';
import { retryTransient } from '../orchestration/transientRetry.js';
import { bidDocumentUrl, bidKindLabel, categoryOf, istIso, portalStyleDate, sameCategory, type GemBid } from './gemBid.js';
import type { GemBidType, GemClient } from './gemClient.js';
import { findBidsClosingOn, findBidsStartedOn } from './gemDaySearch.js';
import { findBidsWithWords, hasSearchWord, type SearchWordHit } from './gemWordSearch.js';
import {
  attachmentsFromBid, bidSpecificText, factsFromBidText, readableBidText, readPdf as readPdfFile, rupees,
  type GemDocumentFacts, type PdfContent,
} from './gemBidDocument.js';

const CLASSIFIER_VERSION = 'gem-bid-v1';
/**
 * GeM answers about one request in a dozen with "server error" at random, and
 * recovers within seconds; a longer busy spell passes within a minute or so.
 */
export const GEM_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000, 40_000];

function pauseFor(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export interface GemRunDeps {
  jobs: JobRepository;
  jobMachine: JobStateMachine;
  searches: SearchRepository;
  tenders: TenderRepository;
  classifications: ClassificationRepository;
  client: Pick<GemClient, 'listBids' | 'fetchFile'>;
  /** Product bids are searched as well as service bids. */
  includeProducts: boolean;
  /** Every bid that started on the day, counted per GeM category, for the daily report. Only when every list was read. */
  onDayCounts?: (day: string, total: number, categories: Record<string, number>) => void;
  /** GeM's code for each category name in its dropdown (lower-case names). */
  categoryCodes?: ReadonlyMap<string, string>;
  signal?: AbortSignal;
  retryDelaysMs?: readonly number[];
  readPdf?: (data: Uint8Array) => Promise<PdfContent>;
  /** Pause before trying failed bid documents a second time (default 30 s). */
  secondTryDelayMs?: number;
  /** Asks the operator to keep or skip an unsure bid; null when nobody answers. */
  askOperator?: (tender: TenderRow, reason: string, documentUrl: string) => Promise<RunQuestionAnswer | null>;
  /**
   * The operator's GeM search words (Settings > GeM > Search words): every
   * open bid with one is read, whatever its day or category
   * (src/gem/gemWordSearch.ts).
   */
  searchWords?: readonly string[];
  /** A search-word bid to leave alone: already decided by the operator, or already waiting in the Inbox. */
  skipWordHit?: (bid: GemBid) => boolean;
  /** A catch-up search's bid to leave alone, by the same rule: it is in the Inbox or decided already. */
  skipKnown?: (bid: GemBid) => boolean;
}

/** The most pages a catch-up search reads per bid type: about 6,000 service bids close in the coming weeks. */
const MAX_CATCH_UP_PAGES = 2_500;
/** GeM's end-date filter reaches a year ahead. */
function yearAfter(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  date.setFullYear(date.getFullYear() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const quotedWords = (words: readonly string[]) => words.map((word) => `“${word}”`).join(', ');

/**
 * Whether a bid is in a category chosen from GeM's dropdown. GeM's own code
 * decides, as GeM's search does; a bid for several items carries several
 * codes. Without a code (the list could not be read), the category name
 * before " - " is compared instead.
 */
export function inChosenCategory(bid: Pick<GemBid, 'category' | 'categoryCode'>, chosen: string, codes?: ReadonlyMap<string, string>): boolean {
  // The exact entry first, then the category alone: GeM's example after " - " changes over time.
  const code = codes?.get(chosen.replace(/\s+/g, ' ').trim().toLocaleLowerCase()) ?? codes?.get(`category:${gemCategoryKey(chosen)}`);
  if (code) return (bid.categoryCode ?? '').split(',').map((part) => part.trim()).includes(code);
  return sameCategory(categoryOf(chosen), bid.category);
}

const STATES = ['Andaman and Nicobar', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli', 'Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

/** Where the work is: the buyer's state when the buyer is a state, and the delivery PIN code (or city, when the address is hidden). */
export function gemLocation(facts: Pick<GemDocumentFacts, 'ministry' | 'deliveryPincode' | 'deliveryCity'> | null): string | null {
  if (!facts) return null;
  const buyer = facts.ministry?.toLowerCase().replace(/&/g, 'and') ?? '';
  const state = STATES.find((name) => buyer.startsWith(name.toLowerCase()));
  const parts = [state, facts.deliveryPincode ? `PIN ${facts.deliveryPincode}` : facts.deliveryCity].filter(Boolean);
  return parts.length > 0 ? parts.join(' - ') : null;
}

/** A bid's intent words: see `evaluateTenderIntent`. */
export function gemIntent(bid: Pick<GemBid, 'title'>, bidText: string, keywords: string[]): { title: TextGateResult; intent: TextGateResult } {
  return evaluateTenderIntent(bid.title, bidText, keywords);
}

/** In a chosen category other than custom bids: the category itself is the work. */
export function isOwnCategory(bid: Pick<GemBid, 'category' | 'categoryCode'>, chosen: readonly string[], codes?: ReadonlyMap<string, string>): boolean {
  if (/^custom bid for services$/i.test(bid.category.trim())) return false;
  return chosen.some((name) => !/^custom bid for services$/i.test(name.trim()) && inChosenCategory(bid, name, codes));
}

export function bidFileName(bid: Pick<GemBid, 'bidNumber'>): string {
  return `GeM bid ${bid.bidNumber.replace(/[\\/]/g, '-')}.pdf`;
}

const shortDay = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** The "Label: value" lines the tender file, sheet and requirement reader understand. */
export function detailFieldsFor(bid: GemBid, facts: GemDocumentFacts | null): Array<{ label: string; value: string | null }> {
  const qualification = facts && [
    facts.minimumTurnover && `minimum average annual turnover ${facts.minimumTurnover}`,
    facts.pastExperience && `${facts.pastExperience} of past experience`,
    facts.mseRelaxation && `MSE relaxation: ${facts.mseRelaxation}`,
    facts.startupRelaxation && `startup relaxation: ${facts.startupRelaxation}`,
  ].filter(Boolean).join('; ');
  const organisation = [facts?.ministry ?? bid.ministry, facts?.department ?? bid.department, facts?.organisation, facts?.office]
    .filter((part): part is string => Boolean(part));
  return [
    { label: 'Bid Number', value: bid.bidNumber },
    { label: 'Bid Type', value: [bidKindLabel(bid), facts?.bidType].filter(Boolean).join(', ') },
    { label: 'Work Description', value: bid.title },
    { label: 'Item Category', value: facts?.itemCategory ?? bid.itemName },
    { label: 'GeM Category', value: bid.category },
    { label: 'Organisation Chain', value: organisation.length > 0 ? organisation.join('||') : null },
    { label: 'Tender Value in ₹', value: rupees(facts?.estimatedValue ?? null) },
    { label: 'EMD Amount in ₹', value: rupees(facts?.emdAmount ?? null) },
    { label: 'ePBG Percentage', value: facts?.epbgPercentage ? `${facts.epbgPercentage}%` : null },
    { label: 'Bid Start Date', value: portalStyleDate(bid.startsAt) },
    { label: 'Bid Submission End Date', value: facts?.bidEndsAt ?? portalStyleDate(bid.endsAt) },
    { label: 'Bid Opening Date', value: facts?.bidOpensAt ?? null },
    { label: 'Pre Bid Meeting Date', value: facts?.preBidAt ?? null },
    { label: 'Location', value: gemLocation(facts) },
    { label: 'Bid Offer Validity', value: facts?.offerValidity ?? null },
    { label: 'Period of Work', value: facts?.contractPeriod ?? null },
    { label: 'Pre-Qualification', value: qualification || null },
    { label: 'Documents Required from Seller', value: facts?.documentsRequired ?? null },
    { label: 'Evaluation Method', value: facts?.evaluationMethod ?? null },
    { label: 'Bid to Reverse Auction', value: facts?.bidToRa ?? null },
    { label: 'Quantity', value: facts?.totalQuantity ?? (bid.quantity !== null ? String(bid.quantity) : null) },
    { label: 'Parent Bid', value: bid.parentBidNumber },
    { label: 'Parent Bid ID', value: bid.parentBidId ?? null },
  ];
}

function detailTextFor(bid: GemBid, facts: GemDocumentFacts | null, body: string): string {
  const lines = detailFieldsFor(bid, facts)
    .filter((field): field is { label: string; value: string } => Boolean(field.value?.trim()))
    .map((field) => `${field.label}: ${field.value!.replace(/\s+/g, ' ').trim()}`);
  return `${lines.join('\n')}\n\n${body}`;
}

/** "07-10-2026 12:00:00" → "07-Oct-2026 12:00 PM", the closing-date form every website uses here. */
function closingFromPdf(raw: string | null): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}:\d{2}):\d{2}$/.exec(raw ?? '');
  return match ? portalStyleDate(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:00`) : null;
}

export interface GemBidDetails {
  documentUrl: string;
  content: PdfContent | null;
  facts: GemDocumentFacts | null;
  readError: string | null;
}

type BidReadDeps = {
  client: Pick<GemClient, 'fetchFile'>;
  tenders: TenderRepository;
  readPdf?: (data: Uint8Array) => Promise<PdfContent>;
  retry?: <T>(task: () => Promise<T>) => Promise<T>;
};

async function readBidPdf(deps: BidReadDeps, url: string): Promise<{ content: PdfContent | null; readError: string | null }> {
  const retry = deps.retry ?? (<T>(task: () => Promise<T>) => task());
  try {
    const file = await retry(() => deps.client.fetchFile(url));
    if (!/pdf/i.test(file.contentType) && file.body.subarray(0, 5).toString() !== '%PDF-') throw new Error('GeM did not return the bid PDF.');
    return { content: await (deps.readPdf ?? readPdfFile)(new Uint8Array(file.body)), readError: null };
  } catch (error) {
    return { content: null, readError: error instanceof Error ? error.message : String(error) };
  }
}

/** The RA's own facts, with what only its bid's PDF gives (EMD, turnover, value…) filled in. */
function withParentFacts(facts: GemDocumentFacts | null, parent: GemDocumentFacts | null): GemDocumentFacts | null {
  if (!facts || !parent) return facts ?? parent;
  const merged = { ...facts };
  for (const key of Object.keys(parent) as Array<keyof GemDocumentFacts>) merged[key] ??= parent[key];
  return merged;
}

/**
 * Downloads a bid's PDF and records what it says on the tender: its facts,
 * text, and the files to save (the PDF and the buyer's attachments). A PDF
 * that cannot be read is recorded too, and still listed for saving. A reverse
 * auction also gets the PDF and attachments of the bid it came from: the RA
 * PDF holds only the auction, the bid's PDF the work and its conditions.
 */
export async function readGemBidDetails(deps: BidReadDeps, tenderId: string, bid: GemBid): Promise<GemBidDetails> {
  const documentUrl = bidDocumentUrl(bid);
  const { content, readError } = await readBidPdf(deps, documentUrl);
  const parentUrl = bid.kind === 'RA' && bid.parentBidId ? bidDocumentUrl({ id: bid.parentBidId, kind: 'BID' }) : null;
  const parent = parentUrl ? await readBidPdf(deps, parentUrl) : null;
  const facts = withParentFacts(content ? factsFromBidText(content.text) : null, parent?.content ? factsFromBidText(parent.content.text) : null);
  const links = [
    { url: documentUrl, fileName: bidFileName(bid) },
    ...(content ? attachmentsFromBid(content) : []),
    ...(parentUrl ? [{ url: parentUrl, fileName: bidFileName({ bidNumber: bid.parentBidNumber ?? `bid ${bid.parentBidId}` }) }] : []),
    // Prefixed, so a name both PDFs use ("Service level agreement.pdf") is not saved over.
    ...(parent?.content ? attachmentsFromBid(parent.content).map((file) => ({ ...file, fileName: `Original bid - ${file.fileName}` })) : []),
  ];
  deps.tenders.updateDetail(tenderId, {
    organisationChain: [facts?.ministry ?? bid.ministry, facts?.department ?? bid.department, facts?.organisation, facts?.office].filter(Boolean).join('||') || null,
    department: facts?.department ?? bid.department,
    publishedDate: istIso(bid.startsAt),
    productCategory: bid.category,
    tenderCategory: bidKindLabel(bid),
    detailText: detailTextFor(bid, facts, content ? readableBidText(content.text) : `The bid PDF could not be read: ${readError}`),
    documentLinks: [...new Map(links.map((link) => [link.url, link])).values()],
    valueInRupees: rupees(facts?.estimatedValue ?? null),
    closingDate: closingFromPdf(facts?.bidEndsAt ?? null),
  });
  return { documentUrl, content, facts, readError };
}

/** A bid rebuilt from a saved GeM tender, enough to read its PDF again. */
export function bidFromTender(tender: TenderRow): GemBid {
  const [ministry, department] = (tender.organisation_chain ?? '').split('||').map((part) => part.trim() || null);
  const wallClock = (iso: string | null) => iso?.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)?.[1] ?? null;
  return {
    id: tender.tender_portal_id ?? '',
    bidNumber: tender.tender_ref,
    kind: /\/R\//.test(tender.tender_ref) ? 'RA' : 'BID',
    title: tender.title,
    itemName: tender.product_category,
    category: tender.product_category,
    categoryCode: null,
    ministry: ministry ?? null,
    department: tender.department ?? department ?? null,
    startsAt: wallClock(tender.published_date),
    endsAt: null,
    quantity: null,
    parentBidNumber: /^Parent Bid: (.+)$/m.exec(tender.detail_text ?? '')?.[1].trim() ?? null,
    parentBidId: /^Parent Bid ID: (\d+)$/m.exec(tender.detail_text ?? '')?.[1] ?? null,
    cancelled: false,
    highValue: false,
    rateContract: false,
    globalTender: false,
  };
}

export async function runGemDate(
  deps: GemRunDeps,
  jobId: string,
  config: RunConfiguration,
  onUpdate: (update: AuthJobUpdate) => void,
): Promise<AuthJobUpdate> {
  const { jobs, jobMachine, searches, tenders, classifications } = deps;
  const readPdf = deps.readPdf ?? readPdfFile;
  const retryDelaysMs = deps.retryDelaysMs ?? GEM_RETRY_DELAYS_MS;
  let phase: AuthJobUpdate['phase'] = 'SEARCH';
  let statusMessage = 'Opening GeM’s list of bids.';
  const snapshot = (outcome?: 'SUCCESS' | 'ABORTED', abortReason?: string): AuthJobUpdate => ({
    jobId, authSessionId: '', authState: 'NOT_STARTED', jobState: jobs.getById(jobId)!.state,
    phase, statusMessage, outcome, abortReason,
  });
  const emit = () => onUpdate(snapshot());
  const cancelled = (): AuthJobUpdate => {
    markJobCancelled(jobs, jobMachine, jobId);
    const final = snapshot('ABORTED', USER_CANCELLED_REASON);
    onUpdate(final);
    return final;
  };
  const retry = <T>(task: () => Promise<T>, label: string) => retryTransient(task, {
    delaysMs: retryDelaysMs,
    signal: deps.signal,
    canRetry: () => !isCancellationRequested(deps.signal),
    onRetry: (attempt) => {
      statusMessage = `${label}: GeM was busy for a moment; asking again.`;
      emit();
    },
  });

  if (isCancellationRequested(deps.signal)) return cancelled();
  jobMachine.transition(jobId, 'SEARCHING', 'GeM bid list search started');
  emit();

  const day = config.searchDate;
  const closing = config.dateMeaning === 'CLOSING';
  // A catch-up search: every open bid closing on closingFrom or later (enough time to prepare).
  const closingFrom = config.dateMeaning === 'CLOSING_AFTER' ? config.closingFrom ?? day : null;
  const onDay = closingFrom ? `closing on ${shortDay(closingFrom)} or later` : `${closing ? 'closing' : 'started'} on ${shortDay(day)}`;
  let skippedKnown = 0;
  const bidTypes: Array<{ type: GemBidType; label: string }> = [
    { type: 'service', label: 'service bids' },
    ...(deps.includeProducts ? [{ type: 'product' as const, label: 'product bids' }] : []),
  ];
  const found = new Map<string, GemBid>();
  const failed: string[] = [];
  /** Closing days where GeM counted more bids than could be read (its list moved too much). */
  const short: string[] = [];
  for (const { type, label } of bidTypes) {
    if (isCancellationRequested(deps.signal)) return cancelled();
    const key = `gem_${type}`;
    const search = searches.findByJobAndKey(jobId, key) ?? searches.create(jobId, key, `GeM ${label}`);
    searches.updateState(search.id, 'RUNNING');
    statusMessage = `Finding GeM ${label} ${onDay}.`;
    emit();
    const onProgress = (progress: { found: number; pagesRead: number }) => {
      statusMessage = `Finding GeM ${label} ${onDay}: ${progress.found} found, ${progress.pagesRead} pages read.`;
      emit();
    };
    try {
      let bids: GemBid[];
      if (closingFrom) {
        const result = await findBidsClosingOn(
          (page) => retry(() => deps.client.listBids({ page, bidType: type, endsBetween: { from: closingFrom, to: yearAfter(closingFrom) } }), `GeM ${label}`),
          onProgress, { maxPages: MAX_CATCH_UP_PAGES, countMayMove: true });
        if (!result.complete) short.push(`${label} (${result.bids.length} of ${result.total} read)`);
        bids = result.bids.filter((bid) => !bid.endsAt || bid.endsAt.slice(0, 10) >= closingFrom);
        const before = bids.length;
        bids = bids.filter((bid) => !deps.skipKnown?.(bid));
        skippedKnown += before - bids.length;
      } else if (closing) {
        const result = await findBidsClosingOn(
          (page) => retry(() => deps.client.listBids({ page, bidType: type, endsBetween: { from: day, to: day } }), `GeM ${label}`), onProgress);
        if (!result.complete) short.push(`${label} (${result.bids.length} of ${result.total} read)`);
        // GeM's filter is by Indian day, as the end time is; keep only that day.
        bids = result.bids.filter((bid) => !bid.endsAt || bid.endsAt.startsWith(day));
      } else {
        bids = await findBidsStartedOn(day, (page) => retry(() => deps.client.listBids({ page, bidType: type }), `GeM ${label}`), onProgress);
      }
      for (const bid of bids) if (!bid.cancelled) found.set(bid.id, bid);
      searches.updateProgress(search.id, 0, bids.length);
      searches.updateState(search.id, 'COMPLETE');
    } catch (error) {
      searches.updateState(search.id, 'INTERRUPTED');
      if (isCancellationRequested(deps.signal)) return cancelled();
      const message = error instanceof Error ? error.message : String(error);
      searches.markFailed(search.id, message, (error as { attempts?: number }).attempts ?? 1);
      failed.push(label);
    }
  }
  if (isCancellationRequested(deps.signal)) return cancelled();
  if (failed.length === bidTypes.length) {
    jobMachine.transition(jobId, 'FAILED_RETRYABLE', 'GeM bid list could not be read');
    phase = 'SEARCH';
    const final = snapshot('ABORTED', 'GeM’s bid list could not be read. Check the internet connection and run this date again.');
    onUpdate(final);
    return final;
  }
  jobMachine.transition(jobId, 'CLASSIFYING', failed.length > 0 ? `GeM search finished; not searched: ${failed.join(', ')}` : 'GeM search finished');
  // The daily report counts the bids that started on a day; a closing day is not that.
  if (failed.length === 0 && !closing && !closingFrom && deps.onDayCounts) {
    const categories: Record<string, number> = {};
    for (const bid of found.values()) categories[bid.category || 'Not stated'] = (categories[bid.category || 'Not stated'] ?? 0) + 1;
    try { deps.onDayCounts(day, found.size, categories); } catch { /* the report count is a bonus; never stop the run */ }
  }

  // The search words: open bids with one of them, whatever their day or
  // category. Each is checked for the word itself (GeM's box is loose).
  const wordHits = new Map<string, SearchWordHit>();
  const wordOnly: GemBid[] = [];
  let wordNote = '';
  if (deps.searchWords && deps.searchWords.length > 0) {
    statusMessage = `Looking for GeM bids with your search words: ${quotedWords(deps.searchWords)}.`;
    emit();
    try {
      const result = await findBidsWithWords(deps.searchWords, ['service', 'product'],
        ({ keyword, bidType, page }) => retry(() => deps.client.listBids({ page, bidType, keyword }), 'GeM search words'),
        (progress) => { statusMessage = `Looking for GeM bids with “${progress.word}”: ${progress.found} found.`; emit(); });
      for (const hit of result.hits) {
        if (found.has(hit.bid.id)) wordHits.set(hit.bid.id, hit);
        else if (!deps.skipWordHit?.(hit.bid)) { wordHits.set(hit.bid.id, hit); wordOnly.push(hit.bid); }
      }
      if (result.tooCommon.length > 0) {
        wordNote += ` ${result.tooCommon.map((entry) => `“${entry.word}” is on ${entry.total} GeM bids`).join('; ')}, so only the newest were checked: use a longer phrase.`;
      }
    } catch (error) {
      if (isCancellationRequested(deps.signal)) return cancelled();
      wordNote += ` Your search words could not be searched just now (${error instanceof Error ? error.message : String(error)}); the next run tries again.`;
    }
  }

  // Screen every bid on its list record; read only the ones in your categories.
  phase = 'CLASSIFICATION';
  const gate = (tenderId: string, gateName: 'G1' | 'G2' | 'G3' | 'G4', result: 'PASS' | 'REJECT' | 'UNCERTAIN', reasonCode: string, evidence: unknown) =>
    classifications.saveGate({ tenderId, gate: gateName, result, reasonCode, evidence, classifierVersion: CLASSIFIER_VERSION });
  const toRead: Array<{ bid: GemBid; tender: TenderRow; hit?: SearchWordHit }> = [];
  for (const bid of [...found.values(), ...wordOnly]) {
    const tender = tenders.upsert({
      jobId,
      tenderRef: bid.bidNumber,
      tenderPortalId: bid.id,
      title: bid.title,
      organisationChain: [bid.ministry, bid.department].filter(Boolean).join('||') || null,
      department: bid.department,
      stateName: null,
      publishedDate: istIso(bid.startsAt),
      closingDate: portalStyleDate(bid.endsAt),
      openingDate: null,
      productCategory: bid.category,
      valueInRupees: '',
    });
    const hit = wordHits.get(bid.id);
    if (hit) {
      // A search word is the work itself: its day and category do not matter.
      // An excluded word as well is the operator's call, never a silent reject.
      gate(tender.id, 'G1', 'PASS', found.has(bid.id) ? 'SEARCH_DATE_FILTER_MATCH' : 'SEARCH_WORD_MATCH',
        { searchDate: day, dateMeaning: config.dateMeaning ?? 'PUBLISHED', closingFrom, startedAt: bid.startsAt, endsAt: bid.endsAt, searchWords: hit.words });
      gate(tender.id, 'G2', 'PASS', 'SEARCH_WORD_MATCH', { searchWords: hit.words, actual: [bid.category], actualCode: bid.categoryCode, configured: config.productCategories, matched: [] });
      const excluded = evaluateExcludedScope(`${bid.title} ${bid.itemName}`, config.excludedKeywords);
      gate(tender.id, 'G4', excluded.result === 'REJECT' ? 'UNCERTAIN' : excluded.result, excluded.result === 'REJECT' ? 'SEARCH_WORD_AND_EXCLUDED' : excluded.reasonCode,
        { stage: 'TITLE', searchWords: hit.words, matchedExcludedKeywords: excluded.matchedTerms });
      toRead.push({ bid, tender, hit });
      continue;
    }
    gate(tender.id, 'G1', 'PASS', 'SEARCH_DATE_FILTER_MATCH', { searchDate: day, dateMeaning: config.dateMeaning ?? 'PUBLISHED', closingFrom, startedAt: bid.startsAt, endsAt: bid.endsAt });
    const matched = config.productCategories.filter((chosen) => inChosenCategory(bid, chosen, deps.categoryCodes));
    const inCategory = matched.length > 0;
    gate(tender.id, 'G2', inCategory ? 'PASS' : 'REJECT', inCategory ? 'PRODUCT_CATEGORY_MATCH' : 'PRODUCT_CATEGORY_MISMATCH',
      { actual: [bid.category], actualCode: bid.categoryCode, configured: config.productCategories, matched });
    const excluded = evaluateExcludedScope(`${bid.title} ${bid.itemName}`, config.excludedKeywords);
    gate(tender.id, 'G4', excluded.result, excluded.reasonCode, { stage: 'TITLE', matchedExcludedKeywords: excluded.matchedTerms });
    if (inCategory && excluded.result === 'PASS') {
      toRead.push({ bid, tender });
      continue;
    }
    const titleIntent = evaluateIntentKeywords(bid.title, config.keywords, { wholePhrase: true });
    gate(tender.id, 'G3', titleIntent.result, titleIntent.reasonCode, { stage: 'TITLE', matchedKeywords: titleIntent.matchedTerms });
  }

  // A bid whose PDF GeM did not send, even after the retries, is tried once
  // more at the end, after a pause: GeM's busy spells pass.
  const tryAgain: typeof toRead = [];
  for (let pass = 1; pass <= 2; pass += 1) {
    const batch = pass === 1 ? toRead : tryAgain.splice(0);
    if (batch.length === 0) break;
    if (pass === 2) {
      statusMessage = `GeM did not send ${batch.length} bid document${batch.length === 1 ? '' : 's'}; trying ${batch.length === 1 ? 'it' : 'them'} again in a moment.`;
      emit();
      await pauseFor(deps.secondTryDelayMs ?? 30_000, deps.signal);
    }
    for (let index = 0; index < batch.length; index += 1) {
      if (isCancellationRequested(deps.signal)) return cancelled();
      const { bid, tender, hit } = batch[index];
      statusMessage = pass === 1
        ? `Reading bid ${index + 1} of ${batch.length} in your categories${wordHits.size > 0 ? ' or with your search words' : ''} (${found.size} ${onDay}).`
        : `Trying bid document ${index + 1} of ${batch.length} again.`;
      emit();
      const { documentUrl, content, facts, readError } = await readGemBidDetails(
        { client: deps.client, tenders, readPdf, retry: (task) => retry(task, bid.bidNumber) }, tender.id, bid);
      if (isCancellationRequested(deps.signal)) return cancelled();

      if (!content) {
        gate(tender.id, 'G3', 'UNCERTAIN', 'GEM_BID_DOCUMENT_FAILED', { error: readError, attempt: pass });
        if (pass === 1) tryAgain.push(batch[index]);
        statusMessage = pass === 1
          ? `Bid ${index + 1} of ${batch.length}: GeM did not send its document; it is tried again at the end.`
          : `Bid ${index + 1} of ${batch.length}: GeM still did not send its document. Unsure.`;
        emit();
        continue;
      }
      const { title: titleIntent, intent } = gemIntent(bid, bidSpecificText(content.text), config.keywords);
      if (hit) {
        // Kept when the word is in the title or the bid document. The document has every detail of
        // the bid, so a word in neither is GeM matching text that is not about the work: rejected, with that reason.
        const inDocument = hit.words.filter((word) => hasSearchWord(content.text, word));
        if (hit.visible || inDocument.length > 0) {
          gate(tender.id, 'G3', 'PASS', hit.visible ? 'SEARCH_WORD' : 'SEARCH_WORD_IN_DOCUMENT', { searchWords: hit.words, matchedKeywords: intent.matchedTerms });
        } else {
          gate(tender.id, 'G3', 'REJECT', 'SEARCH_WORD_NOT_VISIBLE', { searchWords: hit.words });
        }
        const scope = `${bid.title} ${bid.itemName} ${facts?.itemCategory ?? ''}`;
        const excluded = evaluateExcludedScope(scope, config.excludedKeywords);
        gate(tender.id, 'G4', excluded.result === 'REJECT' ? 'UNCERTAIN' : excluded.result, excluded.result === 'REJECT' ? 'SEARCH_WORD_AND_EXCLUDED' : excluded.reasonCode,
          { searchWords: hit.words, matchedExcludedKeywords: excluded.matchedTerms, evaluatedText: scope });
        const decided = classifications.getFinalForTender(tender.id);
        statusMessage = `Read bid ${index + 1} of ${batch.length}: ${bid.title}. ${decided === 'KEEP' ? `Kept: has ${quotedWords(hit.words)}` : decided === 'REJECT' ? `Rejected: ${quotedWords(hit.words)} is not in it` : 'Unsure'}.`;
        emit();
        if (deps.askOperator && decided === 'UNCERTAIN' && excluded.result === 'REJECT') {
          const reason = `It has your search word ${quotedWords(hit.words)} and your excluded word ${quotedWords(excluded.matchedTerms)}.`;
          await deps.askOperator(tenders.getById(tender.id) ?? tender, reason, documentUrl);
          if (isCancellationRequested(deps.signal)) return cancelled();
        }
        continue;
      }
      if (isOwnCategory(bid, config.productCategories, deps.categoryCodes)) {
        // A chosen GeM category other than custom bids is the work itself.
        gate(tender.id, 'G3', 'PASS', 'CHOSEN_CATEGORY', { matchedKeywords: intent.matchedTerms, category: bid.category });
      } else {
        gate(tender.id, 'G3', intent.result, intent.reasonCode, { matchedKeywords: intent.matchedTerms, configuredKeywords: config.keywords });
      }
      if (facts?.itemCategory) {
        const scope = `${bid.title} ${facts.itemCategory}`;
        const excluded = evaluateExcludedScope(scope, config.excludedKeywords);
        gate(tender.id, 'G4', excluded.result, excluded.reasonCode, { matchedExcludedKeywords: excluded.matchedTerms, evaluatedText: scope });
      }
      // One line per bid read, so the run panel always shows movement.
      const decided = classifications.getFinalForTender(tender.id);
      statusMessage = `Read bid ${index + 1} of ${batch.length}: ${bid.title}. ${decided === 'KEEP' ? 'Kept' : decided === 'REJECT' ? 'Rejected' : 'Unsure'}.`;
      emit();

      const reason = deps.askOperator
        ? unsureReason(classifications.getFinalForTender(tender.id), isOwnCategory(bid, config.productCategories, deps.categoryCodes) ? { result: 'PASS', reasonCode: 'CHOSEN_CATEGORY', matchedTerms: [] } : titleIntent, intent.matchedTerms)
        : null;
      if (deps.askOperator && reason) {
        const answer = await deps.askOperator(tenders.getById(tender.id) ?? tender, reason, documentUrl);
        if (isCancellationRequested(deps.signal)) return cancelled();
        if (answer === null && classifications.getFinalForTender(tender.id) === 'KEEP') {
          // Nobody answered: a keep resting only on its details is left for the operator.
          gate(tender.id, 'G3', 'UNCERTAIN', 'INTENT_ONLY_IN_DETAILS', { matchedKeywords: intent.matchedTerms, configuredKeywords: config.keywords, unanswered: true });
        }
      }
    }
  }

  if (isCancellationRequested(deps.signal)) return cancelled();
  jobMachine.transition(jobId, 'SHORTLISTED', `GeM bids decided: ${found.size} found, ${toRead.length} read`);
  statusMessage = failed.length > 0
    ? `${found.size} GeM bids found; ${failed.join(' and ')} could not be searched, so some may be missing. Run this date again later.`
    : `${found.size} GeM bids ${onDay}; ${toRead.length - wordOnly.length} were in your categories and were read.`;
  if (skippedKnown > 0) statusMessage += ` ${skippedKnown} more were already in your Inbox or decided, so they were not read again.`;
  if (wordOnly.length > 0) statusMessage += ` ${wordOnly.length} more open ${wordOnly.length === 1 ? 'bid has' : 'bids have'} your search words and ${wordOnly.length === 1 ? 'was' : 'were'} read.`;
  statusMessage += wordNote;
  if (short.length > 0) statusMessage += ` GeM’s list changed while it was read, so a few may be missing: ${short.join(', ')}. Run this date again to pick them up.`;
  const final = snapshot('SUCCESS');
  onUpdate(final);
  return final;
}
