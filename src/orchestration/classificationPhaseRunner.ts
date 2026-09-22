import type { Page } from 'playwright-core';
import type { JobRepository } from '../persistence/repositories/jobRepository.js';
import type { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import type { TenderRepository } from '../persistence/repositories/tenderRepository.js';
import type { ClassificationRepository } from '../persistence/repositories/classificationRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';
import type { RunConfiguration } from '../config/runConfiguration.js';
import { navigateToMyTenders, reviewTenderFromMyTenders } from '../browser/myTendersController.js';
import { parseTenderPortalDate } from '../search/tenderDateParser.js';
import { evaluateGate1 } from '../classification/gate1Freshness.js';
import { evaluateIntentKeywords, evaluateExcludedScope } from '../classification/intentGates.js';
import type { AuthJobUpdate } from './authJobRunner.js';

const CLASSIFIER_VERSION = 'deterministic-detail-v1';

export interface ClassificationPhaseDeps {
  jobs: JobRepository;
  sessions: AuthSessionRepository;
  jobMachine: JobStateMachine;
  tenders: TenderRepository;
  classifications: ClassificationRepository;
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
  onUpdate: (update: AuthJobUpdate) => void
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

  onUpdate(snapshot());
  const currentJobTenders = tenders.listForJob(jobId).filter((tender) => tender.favorited === 1);
  if (currentJobTenders.length === 0) {
    jobMachine.transition(jobId, 'SHORTLISTED', 'no current-job favorites required classification');
    const final = snapshot('SUCCESS');
    onUpdate(final);
    return final;
  }

  try {
    await navigateToMyTenders(page);
  } catch (error) {
    if (jobs.getById(jobId)?.state === 'CLASSIFYING') {
      jobMachine.transition(jobId, 'FAILED_RETRYABLE', 'could not open My Tenders for classification');
    }
    const final = snapshot('ABORTED', error instanceof Error ? error.message : String(error));
    onUpdate(final);
    return final;
  }

  const evaluatedAgainst = `${config.searchDate}T23:59:59+05:30`;
  for (const tender of currentJobTenders) {
    try {
      const detail = await reviewTenderFromMyTenders(page, tender);
      const publishedDate = detail.publishedDateRaw ? parseTenderPortalDate(detail.publishedDateRaw) : null;
      const detailProductCategory = detail.productCategories[0] ?? null;
      tenders.updateDetail(tender.id, {
        organisationChain: detail.organisationChain,
        publishedDate,
        productCategory: detailProductCategory,
        tenderCategory: detail.tenderCategory,
        detailText: detail.bodyText,
      });

      const g1 = evaluateGate1(publishedDate, evaluatedAgainst, 7);
      classifications.saveGate({
        tenderId: tender.id,
        gate: 'G1',
        result: g1.result,
        reasonCode: g1.reason_code,
        evidence: g1,
        classifierVersion: CLASSIFIER_VERSION,
      });

      const matchedCategories = detail.productCategories.filter((actual) =>
        config.productCategories.some((configured) => sameCategory(actual, configured))
      );
      classifications.saveGate({
        tenderId: tender.id,
        gate: 'G2',
        result: matchedCategories.length > 0 ? 'PASS' : 'REJECT',
        reasonCode: matchedCategories.length > 0 ? 'PRODUCT_CATEGORY_MATCH' : 'PRODUCT_CATEGORY_MISMATCH',
        evidence: { actual: detail.productCategories, configured: config.productCategories, matched: matchedCategories },
        classifierVersion: CLASSIFIER_VERSION,
      });

      const g3 = evaluateIntentKeywords(detail.bodyText, config.keywords);
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
    } catch (error) {
      const evidence = { error: error instanceof Error ? error.message : String(error) };
      for (const gate of ['G1', 'G2', 'G3', 'G4'] as const) {
        classifications.saveGate({
          tenderId: tender.id,
          gate,
          result: 'UNCERTAIN',
          reasonCode: 'DETAIL_REVIEW_FAILED',
          evidence,
          classifierVersion: CLASSIFIER_VERSION,
        });
      }
    }
    onUpdate(snapshot());
  }

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
