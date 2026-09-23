// src/orchestration/searchPhaseRunner.ts
import type { Page } from 'playwright-core';
import type { JobRepository } from '../persistence/repositories/jobRepository.js';
import type { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';
import type { SearchRepository } from '../persistence/repositories/searchRepository.js';
import type { TenderRepository } from '../persistence/repositories/tenderRepository.js';
import type { ClassificationRepository } from '../persistence/repositories/classificationRepository.js';
import { CONFIGURED_SEARCHES } from '../search/searchConfig.js';
import { searchCategory, favoriteVisibleRows } from '../browser/searchFormController.js';
import { reviewTenderFromSearchResults } from '../browser/myTendersController.js';
import type { AuthJobUpdate } from './authJobRunner.js';
import type { ConfiguredSearch } from '../search/searchConfig.js';
import { isCancellationRequested, markJobCancelled, USER_CANCELLED_REASON } from './jobCancellation.js';
import { triageTenderDetail, triageTenderTitle, type PreFavoriteIntent } from '../classification/preFavoriteTriage.js';
import type { PaceAction } from './actionPacer.js';

export interface SearchPhaseDeps {
  jobs: JobRepository;
  sessions: AuthSessionRepository;
  jobMachine: JobStateMachine;
  searches: SearchRepository;
  tenders: TenderRepository;
  classifications: ClassificationRepository;
  signal?: AbortSignal;
  paceAction?: PaceAction;
}

const PREFAVORITE_CLASSIFIER_VERSION = 'prefavorite-title-detail-v1';

function formatDdMmYyyy(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function runSearchPhase(
  deps: SearchPhaseDeps,
  page: Page,
  jobId: string,
  authSessionId: string,
  onUpdate: (update: AuthJobUpdate) => void,
  searchDate: Date = new Date(),
  configuredSearches: ConfiguredSearch[] = CONFIGURED_SEARCHES,
  intent?: PreFavoriteIntent
): Promise<AuthJobUpdate> {
  const { jobs, sessions, jobMachine, searches, tenders, classifications } = deps;
  let statusMessage = 'Preparing the configured product-category searches.';

  const snapshot = (outcome?: 'SUCCESS' | 'ABORTED', abortReason?: string): AuthJobUpdate => ({
    jobId,
    authSessionId,
    jobState: jobs.getById(jobId)!.state,
    authState: sessions.getById(authSessionId)!.state,
    outcome,
    abortReason,
    phase: 'SEARCH',
    statusMessage,
  });

  const cancelled = (): AuthJobUpdate => {
    markJobCancelled(jobs, jobMachine, jobId);
    const final = snapshot('ABORTED', USER_CANCELLED_REASON);
    onUpdate(final);
    return final;
  };

  if (isCancellationRequested(deps.signal)) return cancelled();

  jobMachine.transition(jobId, 'SEARCHING', 'search phase started');

  onUpdate(snapshot());

  const targetDate = formatDdMmYyyy(searchDate);

  for (const config of configuredSearches) {
    if (isCancellationRequested(deps.signal)) return cancelled();
    const existing = searches.findByJobAndKey(jobId, config.searchKey);
    const search = existing ?? searches.create(jobId, config.searchKey, config.productCategory);
    if (search.state === 'COMPLETE') continue;

    searches.updateState(search.id, 'RUNNING');
    statusMessage = `Searching ${config.productCategory} and screening titles before favouriting.`;
    onUpdate(snapshot());

    try {
      const rows = await searchCategory(page, config.productCategory, targetDate, deps.paceAction);
      if (isCancellationRequested(deps.signal)) return cancelled();

      const favoriteReferences: string[] = [];
      let rejectedCount = 0;
      let heldCount = 0;
      for (const row of rows) {
        const tender = tenders.upsert({
          jobId,
          tenderRef: row.referenceNumber,
          tenderPortalId: row.tenderId,
          title: row.title,
          organisationChain: null,
          publishedDate: null,
          closingDate: null,
          openingDate: null,
          productCategory: row.productCategory,
          valueInRupees: row.valueInRupees,
        });

        if (!intent) {
          favoriteReferences.push(row.referenceNumber);
          continue;
        }

        classifications.saveGate({
          tenderId: tender.id, gate: 'G1', result: 'PASS', reasonCode: 'SEARCH_DATE_FILTER_MATCH',
          evidence: { searchDate: targetDate }, classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
        });
        classifications.saveGate({
          tenderId: tender.id, gate: 'G2', result: 'PASS', reasonCode: 'SEARCH_RESULT_CATEGORY_MATCH',
          evidence: { actual: [row.productCategory], matched: [row.productCategory] }, classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
        });

        const titleDecision = triageTenderTitle(row.title, intent);
        if (titleDecision.action === 'REJECT') {
          classifications.saveGate({
            tenderId: tender.id, gate: 'G3', result: titleDecision.intent.result,
            reasonCode: titleDecision.intent.reasonCode,
            evidence: { stage: 'TITLE', confidence: titleDecision.confidence, matchedKeywords: titleDecision.intent.matchedTerms },
            classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
          });
          classifications.saveGate({
            tenderId: tender.id, gate: 'G4', result: titleDecision.exclusion.result,
            reasonCode: titleDecision.reasonCode,
            evidence: { stage: 'TITLE', confidence: titleDecision.confidence, matchedExcludedKeywords: titleDecision.exclusion.matchedTerms },
            classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
          });
          rejectedCount += 1;
          continue;
        }

        if (titleDecision.action === 'FAVORITE') {
          classifications.saveGate({
            tenderId: tender.id, gate: 'G3', result: 'UNCERTAIN',
            reasonCode: 'TITLE_INTENT_MATCH_PENDING_DETAIL',
            evidence: { stage: 'TITLE', confidence: titleDecision.confidence, matchedKeywords: titleDecision.intent.matchedTerms },
            classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
          });
          classifications.saveGate({
            tenderId: tender.id, gate: 'G4', result: 'PASS', reasonCode: titleDecision.exclusion.reasonCode,
            evidence: { stage: 'TITLE', confidence: titleDecision.confidence, matchedExcludedKeywords: [] },
            classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
          });
          favoriteReferences.push(row.referenceNumber);
          continue;
        }

        try {
          const detail = await reviewTenderFromSearchResults(page, tender, deps.paceAction);
          const detailProductCategory = detail.productCategories[0] ?? null;
          tenders.updateDetail(tender.id, {
            organisationChain: detail.organisationChain,
            department: detail.department,
            stateName: detail.stateName,
            publishedDate: null,
            productCategory: detailProductCategory,
            tenderCategory: detail.tenderCategory,
            detailText: detail.bodyText,
            documentLinks: detail.documentLinks,
          });
          const primaryScope = [row.title, detail.tenderCategory, ...detail.productCategories].filter(Boolean).join(' ');
          const detailDecision = triageTenderDetail(row.title, detail.bodyText, primaryScope, intent);
          classifications.saveGate({
            tenderId: tender.id, gate: 'G3', result: detailDecision.intent.result,
            reasonCode: detailDecision.reasonCode,
            evidence: { stage: 'DETAIL', confidence: detailDecision.confidence, matchedKeywords: detailDecision.intent.matchedTerms },
            classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
          });
          classifications.saveGate({
            tenderId: tender.id, gate: 'G4', result: detailDecision.exclusion.result,
            reasonCode: detailDecision.exclusion.reasonCode,
            evidence: { stage: 'DETAIL', confidence: detailDecision.confidence, matchedExcludedKeywords: detailDecision.exclusion.matchedTerms },
            classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
          });
          if (detailDecision.action === 'FAVORITE') favoriteReferences.push(row.referenceNumber);
          else if (detailDecision.action === 'REJECT') rejectedCount += 1;
          else heldCount += 1;
        } catch (error) {
          const evidence = { stage: 'DETAIL', confidence: 'LOW', error: error instanceof Error ? error.message : String(error) };
          for (const gate of ['G3', 'G4'] as const) {
            classifications.saveGate({
              tenderId: tender.id, gate, result: 'UNCERTAIN', reasonCode: 'PREFAVORITE_DETAIL_REVIEW_FAILED',
              evidence, classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
            });
          }
          heldCount += 1;
        }
      }

      if (favoriteReferences.length > 0) {
        const favoritedReferences = await favoriteVisibleRows(page, favoriteReferences, deps.paceAction);
        if (isCancellationRequested(deps.signal)) return cancelled();
        const favoritedAt = new Date().toISOString();
        for (const reference of favoritedReferences) {
          const tender = tenders.findByJobAndRef(jobId, reference);
          if (tender) tenders.markFavorited(tender.id, favoritedAt);
        }
        heldCount += favoriteReferences.length - favoritedReferences.length;
        statusMessage = `${config.productCategory}: ${rows.length} found, ${favoritedReferences.length} favourited, ${rejectedCount} rejected, ${heldCount} held for review.`;
      } else {
        statusMessage = `${config.productCategory}: ${rows.length} found, none added to My Tenders, ${rejectedCount} rejected, ${heldCount} held for review.`;
      }

      searches.updateProgress(search.id, 0, rows.length);
      searches.updateState(search.id, 'COMPLETE');
    } catch (err) {
      searches.updateState(search.id, 'INTERRUPTED');
      if (isCancellationRequested(deps.signal)) return cancelled();
      const authState = sessions.getById(authSessionId)!.state;
      if (authState === 'TAB_LOST' || authState === 'SESSION_EXPIRED') {
        const final = snapshot(
          'ABORTED',
          `auth session reached terminal state ${authState} during ${config.productCategory} search`
        );
        onUpdate(final);
        return final;
      }
      // This one category failed for a reason unrelated to the session
      // being lost (e.g. a page-structure surprise) -- the master prompt's
      // own per-category resilience: move on to the next category rather
      // than aborting the whole phase.
    }

    onUpdate(snapshot());
  }

  if (isCancellationRequested(deps.signal)) return cancelled();
  jobMachine.transition(jobId, 'CLASSIFYING', 'all category searches complete');
  const final = snapshot('SUCCESS');
  onUpdate(final);
  return final;
}
