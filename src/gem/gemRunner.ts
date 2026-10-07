// One GeM search date, from the bid list to a decision on every bid: no
// sign-in, no browser. Bids are found by start date, screened on their
// category and title, and the ones in your categories are read from their
// bid PDF. Documents are saved afterwards by the shared post-processing step.

import type { JobRepository } from '../persistence/repositories/jobRepository.js';
import type { SearchRepository } from '../persistence/repositories/searchRepository.js';
import type { TenderRepository, TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { ClassificationRepository } from '../persistence/repositories/classificationRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';
import type { RunConfiguration } from '../config/runConfiguration.js';
import type { AuthJobUpdate } from '../orchestration/authJobRunner.js';
import type { RunQuestionAnswer } from '../orchestration/runQuestion.js';
import { evaluateExcludedScope, evaluateIntentKeywords } from '../classification/intentGates.js';
import { unsureReason } from '../orchestration/classificationPhaseRunner.js';
import { isCancellationRequested, markJobCancelled, USER_CANCELLED_REASON } from '../orchestration/jobCancellation.js';
import { retryTransient } from '../orchestration/transientRetry.js';
import { bidDocumentUrl, bidKindLabel, categoryOf, istIso, portalStyleDate, sameCategory, type GemBid } from './gemBid.js';
import type { GemBidType, GemClient } from './gemClient.js';
import { findBidsStartedOn } from './gemDaySearch.js';
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
  /** GeM's code for each category name in its dropdown (lower-case names). */
  categoryCodes?: ReadonlyMap<string, string>;
  signal?: AbortSignal;
  retryDelaysMs?: readonly number[];
  readPdf?: (data: Uint8Array) => Promise<PdfContent>;
  /** Pause before trying failed bid documents a second time (default 30 s). */
  secondTryDelayMs?: number;
  /** Asks the operator to keep or skip an unsure bid; null when nobody answers. */
  askOperator?: (tender: TenderRow, reason: string, documentUrl: string) => Promise<RunQuestionAnswer | null>;
}

/**
 * Whether a bid is in a category chosen from GeM's dropdown. GeM's own code
 * decides, as GeM's search does; a bid for several items carries several
 * codes. Without a code (the list could not be read), the category name
 * before " - " is compared instead.
 */
export function inChosenCategory(bid: Pick<GemBid, 'category' | 'categoryCode'>, chosen: string, codes?: ReadonlyMap<string, string>): boolean {
  const code = codes?.get(chosen.replace(/\s+/g, ' ').trim().toLocaleLowerCase());
  if (code) return (bid.categoryCode ?? '').split(',').map((part) => part.trim()).includes(code);
  return sameCategory(categoryOf(chosen), bid.category);
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
    { label: 'Bid Offer Validity', value: facts?.offerValidity ?? null },
    { label: 'Period of Work', value: facts?.contractPeriod ?? null },
    { label: 'Pre-Qualification', value: qualification || null },
    { label: 'Documents Required from Seller', value: facts?.documentsRequired ?? null },
    { label: 'Evaluation Method', value: facts?.evaluationMethod ?? null },
    { label: 'Bid to Reverse Auction', value: facts?.bidToRa ?? null },
    { label: 'Quantity', value: facts?.totalQuantity ?? (bid.quantity !== null ? String(bid.quantity) : null) },
    { label: 'Parent Bid', value: bid.parentBidNumber },
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

/**
 * Downloads a bid's PDF and records what it says on the tender: its facts,
 * text, and the files to save (the PDF and the buyer's attachments). A PDF
 * that cannot be read is recorded too, and still listed for saving.
 */
export async function readGemBidDetails(
  deps: {
    client: Pick<GemClient, 'fetchFile'>;
    tenders: TenderRepository;
    readPdf?: (data: Uint8Array) => Promise<PdfContent>;
    retry?: <T>(task: () => Promise<T>) => Promise<T>;
  },
  tenderId: string,
  bid: GemBid,
): Promise<GemBidDetails> {
  const documentUrl = bidDocumentUrl(bid);
  const retry = deps.retry ?? (<T>(task: () => Promise<T>) => task());
  let content: PdfContent | null = null;
  let readError: string | null = null;
  try {
    const file = await retry(() => deps.client.fetchFile(documentUrl));
    if (!/pdf/i.test(file.contentType) && file.body.subarray(0, 5).toString() !== '%PDF-') throw new Error('GeM did not return the bid PDF.');
    content = await (deps.readPdf ?? readPdfFile)(new Uint8Array(file.body));
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error);
  }
  const facts = content ? factsFromBidText(content.text) : null;
  deps.tenders.updateDetail(tenderId, {
    organisationChain: [facts?.ministry ?? bid.ministry, facts?.department ?? bid.department, facts?.organisation, facts?.office].filter(Boolean).join('||') || null,
    department: facts?.department ?? bid.department,
    publishedDate: istIso(bid.startsAt),
    productCategory: bid.category,
    tenderCategory: bidKindLabel(bid),
    detailText: detailTextFor(bid, facts, content ? readableBidText(content.text) : `The bid PDF could not be read: ${readError}`),
    documentLinks: [{ url: documentUrl, fileName: bidFileName(bid) }, ...(content ? attachmentsFromBid(content) : [])],
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
    parentBidNumber: null,
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
  const bidTypes: Array<{ type: GemBidType; label: string }> = [
    { type: 'service', label: 'service bids' },
    ...(deps.includeProducts ? [{ type: 'product' as const, label: 'product bids' }] : []),
  ];
  const found = new Map<string, GemBid>();
  const failed: string[] = [];
  for (const { type, label } of bidTypes) {
    if (isCancellationRequested(deps.signal)) return cancelled();
    const key = `gem_${type}`;
    const search = searches.findByJobAndKey(jobId, key) ?? searches.create(jobId, key, `GeM ${label}`);
    searches.updateState(search.id, 'RUNNING');
    statusMessage = `Finding GeM ${label} that started on ${shortDay(day)}.`;
    emit();
    try {
      const bids = await findBidsStartedOn(day, (page) => retry(() => deps.client.listBids({ page, bidType: type }), `GeM ${label}`), (progress) => {
        statusMessage = `Finding GeM ${label} that started on ${shortDay(day)}: ${progress.found} found, ${progress.pagesRead} pages read.`;
        emit();
      });
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

  // Screen every bid on its list record; read only the ones in your categories.
  phase = 'CLASSIFICATION';
  const gate = (tenderId: string, gateName: 'G1' | 'G2' | 'G3' | 'G4', result: 'PASS' | 'REJECT' | 'UNCERTAIN', reasonCode: string, evidence: unknown) =>
    classifications.saveGate({ tenderId, gate: gateName, result, reasonCode, evidence, classifierVersion: CLASSIFIER_VERSION });
  const toRead: Array<{ bid: GemBid; tender: TenderRow }> = [];
  for (const bid of found.values()) {
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
    gate(tender.id, 'G1', 'PASS', 'SEARCH_DATE_FILTER_MATCH', { searchDate: day, startedAt: bid.startsAt });
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
    const titleIntent = evaluateIntentKeywords(bid.title, config.keywords);
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
      const { bid, tender } = batch[index];
      statusMessage = pass === 1
        ? `Reading bid ${index + 1} of ${batch.length} in your categories (${found.size} started on ${shortDay(day)}).`
        : `Trying bid document ${index + 1} of ${batch.length} again.`;
      emit();
      const { documentUrl, content, facts, readError } = await readGemBidDetails(
        { client: deps.client, tenders, readPdf, retry: (task) => retry(task, bid.bidNumber) }, tender.id, bid);
      if (isCancellationRequested(deps.signal)) return cancelled();

      if (!content) {
        gate(tender.id, 'G3', 'UNCERTAIN', 'GEM_BID_DOCUMENT_FAILED', { error: readError, attempt: pass });
        if (pass === 1) tryAgain.push(batch[index]);
        continue;
      }
      const intent = evaluateIntentKeywords(`${bid.title} ${bidSpecificText(content.text)}`, config.keywords, { wholePhrase: true });
      gate(tender.id, 'G3', intent.result, intent.reasonCode, { matchedKeywords: intent.matchedTerms, configuredKeywords: config.keywords });
      if (facts?.itemCategory) {
        const scope = `${bid.title} ${facts.itemCategory}`;
        const excluded = evaluateExcludedScope(scope, config.excludedKeywords);
        gate(tender.id, 'G4', excluded.result, excluded.reasonCode, { matchedExcludedKeywords: excluded.matchedTerms, evaluatedText: scope });
      }

      const reason = deps.askOperator
        ? unsureReason(classifications.getFinalForTender(tender.id), evaluateIntentKeywords(bid.title, config.keywords), intent.matchedTerms)
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
    : `${found.size} GeM bids started on ${shortDay(day)}; ${toRead.length} were in your categories and were read.`;
  const final = snapshot('SUCCESS');
  onUpdate(final);
  return final;
}
