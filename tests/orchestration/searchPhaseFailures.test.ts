import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { Page } from 'playwright-core';

const attemptsByCategory = new Map<string, number>();
vi.mock('../../src/browser/searchFormController.js', () => ({
  searchCategory: vi.fn(async (_page: unknown, category: string) => {
    const attempt = (attemptsByCategory.get(category) ?? 0) + 1;
    attemptsByCategory.set(category, attempt);
    if (category === 'Flaky') {
      if (attempt < 2) throw Object.assign(new Error('page.click: Timeout 30000ms exceeded.'), { name: 'TimeoutError' });
      return [];
    }
    if (category === 'Down') throw Object.assign(new Error('page.click: Timeout 30000ms exceeded.'), { name: 'TimeoutError' });
    if (category === 'Broken') throw new Error('Search form is missing the category list');
    return [];
  }),
  favoriteVisibleRows: vi.fn(async () => []),
}));

const { runMigrations } = await import('../../src/persistence/migrate.js');
const { JobRepository } = await import('../../src/persistence/repositories/jobRepository.js');
const { AuthSessionRepository } = await import('../../src/persistence/repositories/authSessionRepository.js');
const { StateTransitionRepository } = await import('../../src/persistence/repositories/stateTransitionRepository.js');
const { SearchRepository } = await import('../../src/persistence/repositories/searchRepository.js');
const { TenderRepository } = await import('../../src/persistence/repositories/tenderRepository.js');
const { ClassificationRepository } = await import('../../src/persistence/repositories/classificationRepository.js');
const { JobStateMachine } = await import('../../src/state/jobStateMachine.js');
const { AuthStateMachine } = await import('../../src/state/authStateMachine.js');
const { runSearchPhase } = await import('../../src/orchestration/searchPhaseRunner.js');

describe('runSearchPhase when a category search fails', () => {
  it('retries a timeout, records categories that still fail, and says which may be missing tenders', async () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const jobs = new JobRepository(db);
    const sessions = new AuthSessionRepository(db);
    const transitions = new StateTransitionRepository(db);
    const jobMachine = new JobStateMachine(db, jobs, transitions);
    const authMachine = new AuthStateMachine(db, sessions, transitions);
    const searches = new SearchRepository(db);
    const job = jobs.create();
    for (const state of ['AUTH_REQUIRED', 'AUTH_PENDING', 'AUTHENTICATED'] as const) jobMachine.transition(job.id, state);
    const session = sessions.create(job.id);
    authMachine.transition(session.id, 'AUTH_PENDING');
    authMachine.transition(session.id, 'AUTHENTICATED');

    const result = await runSearchPhase(
      { jobs, sessions, jobMachine, searches, tenders: new TenderRepository(db), classifications: new ClassificationRepository(db), retryDelaysMs: [0, 0] },
      {} as Page,
      job.id,
      session.id,
      () => {},
      new Date(2026, 8, 24),
      ['Fine', 'Flaky', 'Down', 'Broken'].map((productCategory, index) => ({ searchKey: `search_${index + 1}`, productCategory })),
      { keywords: ['software'], excludedKeywords: [] }
    );

    expect(result.outcome).toBe('SUCCESS');
    expect(attemptsByCategory.get('Flaky')).toBe(2);
    expect(attemptsByCategory.get('Down')).toBe(3);
    expect(attemptsByCategory.get('Broken')).toBe(1);

    const byCategory = new Map(searches.listForJob(job.id).map((search) => [search.product_category, search]));
    expect(byCategory.get('Fine')?.state).toBe('COMPLETE');
    expect(byCategory.get('Flaky')?.state).toBe('COMPLETE');
    expect(byCategory.get('Down')).toMatchObject({ state: 'FAILED', attempts: 3 });
    expect(byCategory.get('Broken')).toMatchObject({ state: 'FAILED', attempts: 1, last_error: 'Search form is missing the category list' });
    expect(result.statusMessage).toContain('2 of 4 categories could not be searched (Down, Broken)');
  });
});
