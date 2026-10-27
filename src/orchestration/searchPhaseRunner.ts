// src/orchestration/searchPhaseRunner.ts
import type { Page } from 'playwright-core';
import type { JobRepository } from '../persistence/repositories/jobRepository.js';
import type { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';
import type { SearchRepository } from '../persistence/repositories/searchRepository.js';
import type { TenderRepository } from '../persistence/repositories/tenderRepository.js';
import type { ClassificationRepository } from '../persistence/repositories/classificationRepository.js';
import { CONFIGURED_SEARCHES } from '../search/searchConfig.js';
import { searchActiveTenders, favoriteVisibleRows } from '../browser/searchFormController.js';
import type { AuthJobUpdate } from './authJobRunner.js';
import type { ConfiguredSearch } from '../search/searchConfig.js';
import type { ParsedActiveTenderRow } from '../search/activeTenderRowParser.js';
import { isCancellationRequested, markJobCancelled, USER_CANCELLED_REASON } from './jobCancellation.js';
import { triageTenderTitle, type PreFavoriteIntent } from '../classification/preFavoriteTriage.js';
import type { PaceAction } from './actionPacer.js';
import { DEFAULT_RETRY_DELAYS_MS, retryTransient } from './transientRetry.js';

export interface SearchPhaseDeps {
  jobs: JobRepository;
  sessions: AuthSessionRepository;
  jobMachine: JobStateMachine;
  searches: SearchRepository;
  tenders: TenderRepository;
  classifications: ClassificationRepository;
  signal?: AbortSignal;
  paceAction?: PaceAction;
  /** Pauses between retries of a timed-out search or detail page. */
  retryDelaysMs?: readonly number[];
  /** The portal's entry page, opened again if a step leaves the page blank. */
  portalHomeUrl?: string;
  /** Receives the website's own Product Category list, read once per search phase. */
  onCategoryList?: (categories: string[]) => void;
  /**
   * A tender an earlier search of this day already saw: left alone, so a
   * search from a time of day reads only what is new since.
   */
  seenBefore?: (row: ParsedActiveTenderRow) => boolean;
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
  const retryDelaysMs = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sessionUsable = () => {
    const state = sessions.getById(authSessionId)?.state;
    return state !== 'TAB_LOST' && state !== 'SESSION_EXPIRED' && !isCancellationRequested(deps.signal);
  };
  const failedCategories: string[] = [];
  // Dropped from the website's list: nothing to search again later; pick a replacement instead.
  const notListedCategories: string[] = [];
  const notListedOrganisations: string[] = [];
  let categoryListRead = !deps.onCategoryList;
  const readCategoryList = (categories: string[]) => {
    categoryListRead = true;
    deps.onCategoryList?.(categories);
  };

  for (const config of configuredSearches) {
    if (isCancellationRequested(deps.signal)) return cancelled();
    const existing = searches.findByJobAndKey(jobId, config.searchKey);
    const label = config.organisation ?? config.productCategory;
    const search = existing ?? searches.create(jobId, config.searchKey, label);
    if (search.state === 'COMPLETE') continue;

    searches.updateState(search.id, 'RUNNING');
    statusMessage = `Searching ${label} and screening titles before favouriting.`;
    onUpdate(snapshot());

    try {
      const criteria = config.organisation ? { organisation: config.organisation } : { productCategory: config.productCategory };
      const rows = await retryTransient(() => searchActiveTenders(page, criteria, targetDate, deps.paceAction, deps.portalHomeUrl, categoryListRead ? undefined : readCategoryList), {
        delaysMs: retryDelaysMs,
        canRetry: sessionUsable,
        signal: deps.signal,
        onRetry: (attempt) => {
          statusMessage = `${label}: the portal did not respond, trying again (attempt ${attempt + 1} of ${retryDelaysMs.length + 1}).`;
          onUpdate(snapshot());
        },
      });
      if (isCancellationRequested(deps.signal)) return cancelled();

      const favoriteReferences: string[] = [];
      let rejectedCount = 0;
      let heldCount = 0;
      let seenCount = 0;
      for (const row of rows) {
        if (deps.seenBefore?.(row)) {
          seenCount += 1;
          continue;
        }
        // Found by a category search of this run already: one tender, read once.
        if (config.organisation && tenders.findByJobAndRef(jobId, row.referenceNumber)) continue;
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
          tenderId: tender.id, gate: 'G2', result: 'PASS',
          reasonCode: config.organisation ? 'SEARCH_RESULT_ORGANISATION_MATCH' : 'SEARCH_RESULT_CATEGORY_MATCH',
          evidence: config.organisation
            ? { actual: [row.productCategory], organisation: config.organisation }
            : { actual: [row.productCategory], matched: [row.productCategory] },
          classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
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

        // Not decided by the title: favourite it, and decide in My Tenders
        // from the full tender page. Opening details from the search results
        // instead loses the results page, and the portal signs out.
        classifications.saveGate({
          tenderId: tender.id, gate: 'G3', result: 'UNCERTAIN', reasonCode: 'TITLE_NEEDS_DETAIL',
          evidence: { stage: 'TITLE', confidence: titleDecision.confidence, matchedKeywords: [] },
          classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
        });
        classifications.saveGate({
          tenderId: tender.id, gate: 'G4', result: 'PASS', reasonCode: titleDecision.exclusion.reasonCode,
          evidence: { stage: 'TITLE', confidence: titleDecision.confidence, matchedExcludedKeywords: [] },
          classifierVersion: PREFAVORITE_CLASSIFIER_VERSION,
        });
        favoriteReferences.push(row.referenceNumber);
      }

      if (favoriteReferences.length > 0) {
        const favoritedReferences = await favoriteVisibleRows(page, favoriteReferences, deps.paceAction, deps.portalHomeUrl);
        if (isCancellationRequested(deps.signal)) return cancelled();
        const favoritedAt = new Date().toISOString();
        for (const reference of favoritedReferences) {
          const tender = tenders.findByJobAndRef(jobId, reference);
          if (tender) tenders.markFavorited(tender.id, favoritedAt);
        }
        heldCount += favoriteReferences.length - favoritedReferences.length;
        statusMessage = `${label}: ${rows.length} found, ${favoritedReferences.length} favourited, ${rejectedCount} rejected, ${heldCount} held for review.`;
      } else {
        statusMessage = `${label}: ${rows.length} found, none added to My Tenders, ${rejectedCount} rejected, ${heldCount} held for review.`;
      }
      if (seenCount > 0) statusMessage += ` ${seenCount} already seen by an earlier search of this day, so not read again.`;

      searches.updateProgress(search.id, 0, rows.length);
      searches.updateState(search.id, 'COMPLETE');
    } catch (err) {
      searches.updateState(search.id, 'INTERRUPTED');
      if (isCancellationRequested(deps.signal)) return cancelled();
      const authState = sessions.getById(authSessionId)!.state;
      if (authState === 'TAB_LOST' || authState === 'SESSION_EXPIRED') {
        const final = snapshot(
          'ABORTED',
          `auth session reached terminal state ${authState} during ${label} search`
        );
        onUpdate(final);
        return final;
      }
      // This one category failed for a reason unrelated to the session
      // being lost (a page-structure surprise, or a timeout that outlasted
      // the retries). Move on to the next category, but record why so the
      // run says which categories may be missing tenders.
      const message = err instanceof Error ? err.message : String(err);
      const attempts = (err as { attempts?: number }).attempts ?? 1;
      searches.markFailed(search.id, message, attempts);
      if ((err as Error | null)?.name === 'CategoryNotOnPortalError' || (err as Error | null)?.name === 'OrganisationNotOnPortalError') {
        (config.organisation ? notListedOrganisations : notListedCategories).push(label);
        statusMessage = message;
      } else {
        failedCategories.push(label);
        statusMessage = `${label} could not be searched after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${message}`;
      }
    }

    onUpdate(snapshot());
  }

  if (isCancellationRequested(deps.signal)) return cancelled();
  jobMachine.transition(jobId, 'CLASSIFYING', failedCategories.length > 0
    ? `category searches finished; not searched: ${failedCategories.join(', ')}`
    : 'all category searches complete');
  const notes: string[] = [];
  if (failedCategories.length > 0) {
    notes.push(`${failedCategories.length} of ${configuredSearches.length} categories could not be searched (${failedCategories.join(', ')}). Tenders in them may be missing; run this date again later to fill the gap.`);
  }
  if (notListedCategories.length > 0) {
    notes.push(`${notListedCategories.join(', ')} ${notListedCategories.length === 1 ? 'is' : 'are'} no longer on the website's category list, so ${notListedCategories.length === 1 ? 'it was' : 'they were'} skipped. Choose a replacement on Today or in Settings.`);
  }
  if (notListedOrganisations.length > 0) {
    notes.push(`${notListedOrganisations.join(', ')} ${notListedOrganisations.length === 1 ? 'is' : 'are'} not in the website's organisation list, so ${notListedOrganisations.length === 1 ? 'it was' : 'they were'} skipped. Check the name in Settings.`);
  }
  if (notes.length > 0) statusMessage = `Search finished, but ${notes.join(' ')}`;
  const final = snapshot('SUCCESS');
  onUpdate(final);
  return final;
}
