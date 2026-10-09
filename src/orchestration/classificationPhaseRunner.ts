import type { Page } from 'playwright-core';
import type { JobRepository } from '../persistence/repositories/jobRepository.js';
import type { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import type { TenderRepository, TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { ClassificationRepository, FinalClassification } from '../persistence/repositories/classificationRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';
import type { RunConfiguration } from '../config/runConfiguration.js';
import { tenderPageFacts } from '../review/watchedTenders.js';
import { detailTextFor, navigateToMyTenders, NotInMyTendersError, reviewTendersFromMyTenders, type TenderDetailSnapshot } from '../browser/myTendersController.js';
import { parseTenderPortalDate } from '../search/tenderDateParser.js';
import { evaluateGate1 } from '../classification/gate1Freshness.js';
import { evaluateIntentKeywords, evaluateExcludedScope, evaluateTenderIntent, type TextGateResult } from '../classification/intentGates.js';
import type { AuthJobUpdate } from './authJobRunner.js';
import { isCancellationRequested, markJobCancelled, USER_CANCELLED_REASON } from './jobCancellation.js';
import type { PaceAction } from './actionPacer.js';
import { retryTransient } from './transientRetry.js';
import type { RunQuestionAnswer } from './runQuestion.js';

const CLASSIFIER_VERSION = 'deterministic-detail-v2';

export interface ClassificationPhaseDeps {
  jobs: JobRepository;
  sessions: AuthSessionRepository;
  jobMachine: JobStateMachine;
  tenders: TenderRepository;
  classifications: ClassificationRepository;
  signal?: AbortSignal;
  paceAction?: PaceAction;
  /** Pauses between retries of a timed-out My Tenders page. */
  retryDelaysMs?: readonly number[];
  /**
   * Saves a kept tender's documents while its details page is still open,
   * the only place the portal's document links work.
   */
  saveDocuments?: (tender: TenderRow, detailPage: Page) => Promise<void>;
  /** Whether a decided tender's documents are wanted; defaults to kept tenders. */
  wantsDocuments?: (tenderId: string) => boolean;
  /** The portal's entry page, opened again if a step leaves the page blank. */
  portalHomeUrl?: string;
  /**
   * Asks the operator to keep or skip an unsure tender while its details
   * page is open, and records their answer as their decision. Null means
   * nobody answered in time.
   */
  askOperator?: (tender: TenderRow, detail: TenderDetailSnapshot, reason: string) => Promise<RunQuestionAnswer | null>;
}

/**
 * Why a decided tender is still unsure, or null when it is not: no check
 * could decide it, or it is kept only because an intent word appears
 * somewhere in its details while its title has none.
 */
export function unsureReason(final: FinalClassification, titleIntent: TextGateResult, matchedKeywords: string[]): string | null {
  if (final === 'UNCERTAIN') return 'TenderAssist could not decide it from its details page.';
  if (final === 'KEEP' && titleIntent.result !== 'PASS') {
    const words = matchedKeywords.map((word) => `“${word}”`).join(', ');
    return `Its title has none of your intent words; ${words || 'an intent word'} appears only in its details.`;
  }
  return null;
}

function sameCategory(actual: string, configured: string): boolean {
  return actual.trim().toLocaleLowerCase() === configured.trim().toLocaleLowerCase();
}

export async function runClassificationPhase(
  deps: ClassificationPhaseDeps,
  page: Page,
  jobId: string,
  authSessionId: string,
  config: RunConfiguration,
  onUpdate: (update: AuthJobUpdate) => void,
  portalStateName?: string
): Promise<AuthJobUpdate> {
  const { jobs, sessions, jobMachine, tenders, classifications } = deps;
  const snapshot = (outcome?: 'SUCCESS' | 'ABORTED', abortReason?: string): AuthJobUpdate => ({
    jobId,
    authSessionId,
    jobState: jobs.getById(jobId)!.state,
    authState: sessions.getById(authSessionId)!.state,
    outcome,
    abortReason,
    phase: 'CLASSIFICATION',
  });

  const cancelled = (): AuthJobUpdate => {
    markJobCancelled(jobs, jobMachine, jobId);
    const final = snapshot('ABORTED', USER_CANCELLED_REASON);
    onUpdate(final);
    return final;
  };

  if (isCancellationRequested(deps.signal)) return cancelled();

  onUpdate(snapshot());
  const currentJobTenders = tenders.listForJob(jobId).filter((tender) => tender.favorited === 1);
  if (currentJobTenders.length === 0) {
    jobMachine.transition(jobId, 'SHORTLISTED', 'no current-job favorites required classification');
    const final = snapshot('SUCCESS');
    onUpdate(final);
    return final;
  }

  try {
    await retryTransient(() => navigateToMyTenders(page, deps.paceAction, deps.portalHomeUrl), {
      delaysMs: deps.retryDelaysMs,
      signal: deps.signal,
      canRetry: () => {
        const state = sessions.getById(authSessionId)?.state;
        return state !== 'TAB_LOST' && state !== 'SESSION_EXPIRED';
      },
    });
    if (isCancellationRequested(deps.signal)) return cancelled();
  } catch (error) {
    if (isCancellationRequested(deps.signal)) return cancelled();
    if (jobs.getById(jobId)?.state === 'CLASSIFYING') {
      jobMachine.transition(jobId, 'FAILED_RETRYABLE', 'could not open My Tenders for classification');
    }
    const final = snapshot('ABORTED', error instanceof Error ? error.message : String(error));
    onUpdate(final);
    return final;
  }

  const evaluatedAgainst = `${config.searchDate}T23:59:59+05:30`;
  const matchedIntent = new Map<string, string[]>();
  const titleIntents = new Map<string, TextGateResult>();
  // Each tender is decided from its full details page, and a kept tender's
  // documents are downloaded before that page closes.
  const recordDecision = (tender: TenderRow, detail: TenderDetailSnapshot) => {
    const publishedDate = detail.publishedDateRaw ? parseTenderPortalDate(detail.publishedDateRaw) : null;
    const actualCategories = detail.productCategories.length > 0
      ? detail.productCategories
      : [tender.product_category].filter(Boolean);
    const detailProductCategory = actualCategories[0] ?? null;
    tenders.updateDetail(tender.id, {
      organisationChain: detail.organisationChain,
      department: detail.department ?? detail.organisationChain?.split('||').map((part) => part.trim()).find(Boolean) ?? null,
      stateName: detail.stateName ?? portalStateName ?? null,
      publishedDate,
      productCategory: detailProductCategory,
      tenderCategory: detail.tenderCategory,
      detailText: detailTextFor(detail),
      documentLinks: detail.documentLinks,
      // The current closing date, extensions included: "Bid Submission End Date".
      closingDate: tenderPageFacts(detailTextFor(detail)).closingDateRaw,
    });

    const g1 = publishedDate
      ? evaluateGate1(publishedDate, evaluatedAgainst, 7)
      : {
          result: 'PASS' as const,
          reason_code: 'SEARCH_DATE_FILTER_MATCH',
          published_at: null,
          evaluated_against: evaluatedAgainst,
          age_days: 0,
          max_age_days: 7,
          search_date: config.searchDate,
        };
    classifications.saveGate({
      tenderId: tender.id,
      gate: 'G1',
      result: g1.result,
      reasonCode: g1.reason_code,
      evidence: g1,
      classifierVersion: CLASSIFIER_VERSION,
    });

    const matchedCategories = actualCategories.filter((actual) =>
      config.productCategories.some((configured) => sameCategory(actual, configured))
    );
    classifications.saveGate({
      tenderId: tender.id,
      gate: 'G2',
      result: matchedCategories.length > 0 ? 'PASS' : 'REJECT',
      reasonCode: matchedCategories.length > 0
        ? detail.productCategories.length > 0 ? 'PRODUCT_CATEGORY_MATCH' : 'SEARCH_RESULT_CATEGORY_MATCH'
        : 'PRODUCT_CATEGORY_MISMATCH',
      evidence: { actual: actualCategories, configured: config.productCategories, matched: matchedCategories },
      classifierVersion: CLASSIFIER_VERSION,
    });

    // The portal's own one-line "Work Description" reads like a title; the rest of the page only counts phrases.
    const workDescription = detail.fields.find((field) => /^works*description$/i.test(field.label))?.value ?? '';
    const { title: titleIntent, intent: g3 } = evaluateTenderIntent(`${tender.title} ${workDescription}`, detail.bodyText, config.keywords);
    titleIntents.set(tender.id, titleIntent);
    matchedIntent.set(tender.id, g3.matchedTerms);
    classifications.saveGate({
      tenderId: tender.id,
      gate: 'G3',
      result: g3.result,
      reasonCode: g3.reasonCode,
      evidence: { matchedKeywords: g3.matchedTerms, configuredKeywords: config.keywords },
      classifierVersion: CLASSIFIER_VERSION,
    });

    const primaryScopeText = [tender.title, detail.tenderCategory, ...detail.productCategories].filter(Boolean).join(' ');
    const g4 = evaluateExcludedScope(primaryScopeText, config.excludedKeywords);
    classifications.saveGate({
      tenderId: tender.id,
      gate: 'G4',
      result: g4.result,
      reasonCode: g4.reasonCode,
      evidence: { matchedExcludedKeywords: g4.matchedTerms, evaluatedText: primaryScopeText },
      classifierVersion: CLASSIFIER_VERSION,
    });
  };

  const decided = new Set<string>();
  const reviewBatch = await reviewTendersFromMyTenders(page, currentJobTenders, 100, deps.paceAction, async (tender, detail, detailPage) => {
    if (isCancellationRequested(deps.signal)) return;
    recordDecision(tender, detail);
    decided.add(tender.id);
    const final = classifications.getFinalForTender(tender.id);
    // One line per tender read, so the run panel always shows movement.
    const verdict = final === 'KEEP' ? 'Kept' : final === 'REJECT' ? 'Rejected' : 'Unsure';
    onUpdate({ ...snapshot(), statusMessage: `Read ${decided.size} of ${currentJobTenders.length}: ${tender.title}. ${verdict}.` });
    let answer: RunQuestionAnswer | null = null;
    const matched = matchedIntent.get(tender.id) ?? [];
    const reason = deps.askOperator ? unsureReason(final, titleIntents.get(tender.id) ?? evaluateIntentKeywords(tender.title, config.keywords, { wholePhrase: true }), matched) : null;
    if (deps.askOperator && reason) {
      answer = await deps.askOperator(tender, detail, reason);
      if (isCancellationRequested(deps.signal)) return;
      if (answer === null && final === 'KEEP') {
        // Nobody answered: a keep resting only on its details is left for the operator.
        classifications.saveGate({
          tenderId: tender.id,
          gate: 'G3',
          result: 'UNCERTAIN',
          reasonCode: 'INTENT_ONLY_IN_DETAILS',
          evidence: { matchedKeywords: matched, configuredKeywords: config.keywords, unanswered: true },
          classifierVersion: CLASSIFIER_VERSION,
        });
      }
    }
    const wanted = answer === 'KEEP'
      || (answer === null && (deps.wantsDocuments?.(tender.id) ?? classifications.getFinalForTender(tender.id) === 'KEEP'));
    if (deps.saveDocuments && wanted) {
      onUpdate({ ...snapshot(), statusMessage: `Downloading the documents and zip file for ${tender.title}.` });
      // A failed file is recorded by saveDocuments; the decision stands.
      await deps.saveDocuments(tender, detailPage).catch(() => {});
    }
  }, deps.portalHomeUrl);
  if (isCancellationRequested(deps.signal)) return cancelled();
  for (const tender of currentJobTenders) {
    if (isCancellationRequested(deps.signal)) return cancelled();
    if (decided.has(tender.id)) continue;
    const error = reviewBatch.errors.get(tender.id) ?? new Error('Tender detail review did not return a result.');
    const evidence = { error: error.message };
    // Gone from My Tenders (closed, withdrawn or removed): left for the
    // operator, and no longer carried into later runs to fail again.
    const gone = error instanceof NotInMyTendersError;
    if (gone) tenders.clearFavourite(tender);
    for (const gate of ['G1', 'G2', 'G3', 'G4'] as const) {
      classifications.saveGate({
        tenderId: tender.id,
        gate,
        result: 'UNCERTAIN',
        reasonCode: gone ? 'NOT_IN_MY_TENDERS' : 'DETAIL_REVIEW_FAILED',
        evidence,
        classifierVersion: CLASSIFIER_VERSION,
      });
    }
    onUpdate(snapshot());
  }

  if (isCancellationRequested(deps.signal)) return cancelled();
  const authState = sessions.getById(authSessionId)!.state;
  if (authState === 'TAB_LOST' || authState === 'SESSION_EXPIRED') {
    const final = snapshot('ABORTED', `auth session reached terminal state ${authState} during classification`);
    onUpdate(final);
    return final;
  }

  jobMachine.transition(jobId, 'SHORTLISTED', 'current-job favorites reviewed against run intent');
  const final = snapshot('SUCCESS');
  onUpdate(final);
  return final;
}
