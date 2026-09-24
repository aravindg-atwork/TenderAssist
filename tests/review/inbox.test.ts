import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { OpportunityRepository } from '../../src/persistence/repositories/opportunityRepository.js';
import { buildInbox } from '../../src/review/inbox.js';
import { explainScreening, type ScreenedGate } from '../../src/review/tenderExplanation.js';

const gate = (id: ScreenedGate['gate'], result: ScreenedGate['result'], reasonCode: string, evidence: Record<string, unknown> = {}): ScreenedGate =>
  ({ gate: id, result, reasonCode, evidence });

describe('explainScreening', () => {
  it('names the category and intent phrases behind a recommendation', () => {
    const explanation = explainScreening('KEEP', [
      gate('G1', 'PASS', 'SEARCH_DATE_FILTER_MATCH'),
      gate('G2', 'PASS', 'SEARCH_RESULT_CATEGORY_MATCH', { matched: ['Information Technology'] }),
      gate('G3', 'PASS', 'DETAIL_INTENT_MATCH', { matchedKeywords: ['web portal', 'software development'] }),
      gate('G4', 'PASS', 'NO_EXCLUDED_PRIMARY_SCOPE', { matchedExcludedKeywords: [] }),
    ]);
    expect(explanation.sentence).toBe('Recommended: category “Information Technology”; matched “web portal”, “software development”.');
  });

  it('names the exclusion that rejected a tender', () => {
    const explanation = explainScreening('REJECT', [
      gate('G1', 'PASS', 'SEARCH_DATE_FILTER_MATCH'),
      gate('G4', 'REJECT', 'TITLE_EXCLUDED_SCOPE', { matchedExcludedKeywords: ['supply of computers'] }),
    ]);
    expect(explanation.sentence).toBe('Rejected: matched exclusion “supply of computers”.');
    expect(explanation.matchedExclusions).toEqual(['supply of computers']);
  });

  it('lists every failed check and names missing data as missing', () => {
    expect(explainScreening('REJECT', [
      gate('G1', 'REJECT', 'UNPARSEABLE_PUBLISHED_DATE'),
      gate('G2', 'REJECT', 'PRODUCT_CATEGORY_MISMATCH', { actual: [] }),
      gate('G3', 'REJECT', 'NO_INTENT_KEYWORD_MATCH'),
      gate('G4', 'PASS', 'NO_EXCLUDED_PRIMARY_SCOPE'),
    ]).sentence).toBe('Rejected: published date could not be read; category was not captured; no intent phrase matched.');
  });

  it('explains a failed detail read and a run that never screened', () => {
    expect(explainScreening('UNCERTAIN', [gate('G3', 'UNCERTAIN', 'DETAIL_REVIEW_FAILED', { error: 'timeout' })]).sentence)
      .toBe('Uncertain: the tender detail page could not be read.');
    expect(explainScreening(null, []).sentence).toBe('Not screened yet: the run stopped before its checks finished.');
  });
});

describe('buildInbox', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let tenders: TenderRepository;
  let opportunities: OpportunityRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    tenders = new TenderRepository(db);
    opportunities = new OpportunityRepository(db);
  });

  const screened = (jobId: string, id: string, recommendation: 'KEEP' | 'REJECT' | 'UNCERTAIN', closingDate: string | null = null) => {
    const tender = tenders.upsert({
      jobId, tenderRef: `REF-${id}`, tenderPortalId: id, title: `Tender ${id}`, organisationChain: null,
      publishedDate: null, closingDate, openingDate: null, productCategory: 'IT', valueInRupees: 'NA',
    });
    const opportunity = opportunities.recordSighting(tender, 'tamil-nadu', { jobId });
    return opportunities.recordScreening(opportunity.id, recommendation, { jobId }, {
      gates: recommendation === 'REJECT' ? [gate('G4', 'REJECT', 'TITLE_EXCLUDED_SCOPE', { matchedExcludedKeywords: ['hardware'] })] : [],
    });
  };

  it('groups tenders, hides decided ones, and orders by closing time', () => {
    const job = jobs.create();
    screened(job.id, 'LATE', 'KEEP', '30-Oct-2026 05:00 PM');
    screened(job.id, 'SOON', 'KEEP', '02-Oct-2026 05:00 PM');
    screened(job.id, 'DOUBT', 'UNCERTAIN');
    screened(job.id, 'NO', 'REJECT');
    const decided = screened(job.id, 'DONE', 'KEEP');
    opportunities.decide([decided.id], 'APPROVE');

    const inbox = buildInbox(opportunities);
    expect(inbox.recommended.map((item) => item.tenderId)).toEqual(['SOON', 'LATE']);
    expect(inbox.uncertain.map((item) => item.tenderId)).toEqual(['DOUBT']);
    expect(inbox.autoRejected[0]).toMatchObject({ tenderId: 'NO', matchedExclusions: ['hardware'], screeningJobId: job.id });
    expect(inbox.attentionCount).toBe(3);
  });

  it('drops auto-rejects once their run is acknowledged', () => {
    const job = jobs.create();
    screened(job.id, 'NO', 'REJECT');
    jobs.markReviewed([job.id]);
    expect(buildInbox(opportunities).autoRejected).toEqual([]);
  });

  it('brings back a decided tender that changed, and a rejected one moved to review', () => {
    const job = jobs.create();
    const approved = screened(job.id, 'A', 'KEEP');
    opportunities.decide([approved.id], 'APPROVE');
    opportunities.recordCorrigendum(approved.id, { portalNumber: '1', publishedAt: null, changes: ['DEADLINE'] });
    const rejected = screened(job.id, 'B', 'REJECT');
    jobs.markReviewed([job.id]);
    opportunities.decide([rejected.id], 'REJECT');
    opportunities.decide([rejected.id], 'REOPEN');

    const inbox = buildInbox(opportunities);
    expect(inbox.changed.map((item) => item.tenderId)).toEqual(['A']);
    // Reopened, but its recommendation is still REJECT from an acknowledged
    // run, so it must surface for review rather than vanish.
    expect(inbox.uncertain.map((item) => item.tenderId)).toEqual(['B']);
    expect(inbox.uncertain[0].explanation).toBe('Rejected: matched exclusion “hardware”.');
  });

  it('moves an auto-reject straight to review from the collapsed group', () => {
    const job = jobs.create();
    const rejected = screened(job.id, 'NO', 'REJECT');
    opportunities.decide([rejected.id], 'REOPEN');
    const inbox = buildInbox(opportunities);
    expect(inbox.autoRejected).toEqual([]);
    expect(inbox.uncertain.map((item) => item.tenderId)).toEqual(['NO']);
    expect(opportunities.listEvents(rejected.id).at(-1)).toMatchObject({ kind: 'REOPENED', actor: 'operator' });
  });
});
