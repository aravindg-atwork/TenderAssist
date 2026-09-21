// src/orchestration/searchPhaseRunner.ts
import type { Page } from 'playwright-core';
import type { JobRepository } from '../persistence/repositories/jobRepository.js';
import type { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';
import type { SearchRepository } from '../persistence/repositories/searchRepository.js';
import type { TenderRepository } from '../persistence/repositories/tenderRepository.js';
import { CONFIGURED_SEARCHES } from '../search/searchConfig.js';
import { searchCategory, favoriteAllVisibleRows } from '../browser/searchFormController.js';
import type { AuthJobUpdate } from './authJobRunner.js';

export interface SearchPhaseDeps {
  jobs: JobRepository;
  sessions: AuthSessionRepository;
  jobMachine: JobStateMachine;
  searches: SearchRepository;
  tenders: TenderRepository;
}

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
  onUpdate: (update: AuthJobUpdate) => void
): Promise<AuthJobUpdate> {
  const { jobs, sessions, jobMachine, searches, tenders } = deps;

  jobMachine.transition(jobId, 'SEARCHING', 'search phase started');

  const snapshot = (outcome?: 'SUCCESS' | 'ABORTED', abortReason?: string): AuthJobUpdate => ({
    jobId,
    authSessionId,
    jobState: jobs.getById(jobId)!.state,
    authState: sessions.getById(authSessionId)!.state,
    outcome,
    abortReason,
    phase: 'SEARCH',
  });

  onUpdate(snapshot());

  const today = formatDdMmYyyy(new Date());

  for (const config of CONFIGURED_SEARCHES) {
    const existing = searches.findByJobAndKey(jobId, config.searchKey);
    const search = existing ?? searches.create(jobId, config.searchKey, config.productCategory);
    if (search.state === 'COMPLETE') continue;

    searches.updateState(search.id, 'RUNNING');

    try {
      const rows = await searchCategory(page, config.productCategory, today);

      for (const row of rows) {
        tenders.upsert({
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
      }

      if (rows.length > 0) {
        await favoriteAllVisibleRows(page);
        const favoritedAt = new Date().toISOString();
        for (const row of rows) {
          const tender = tenders.findByJobAndRef(jobId, row.referenceNumber);
          if (tender) tenders.markFavorited(tender.id, favoritedAt);
        }
      }

      searches.updateProgress(search.id, 0, rows.length);
      searches.updateState(search.id, 'COMPLETE');
    } catch (err) {
      searches.updateState(search.id, 'INTERRUPTED');
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

  jobMachine.transition(jobId, 'CLASSIFYING', 'all category searches complete');
  const final = snapshot('SUCCESS');
  onUpdate(final);
  return final;
}
