import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { OpportunityRepository, type OpportunityRow } from '../../src/persistence/repositories/opportunityRepository.js';
import { applyPortalCorrigenda, classifyCorrigendum } from '../../src/review/corrigenda.js';
import { buildInbox } from '../../src/review/inbox.js';
import { buildTenders } from '../../src/review/tenders.js';
import { describeTimeline } from '../../src/review/timeline.js';

describe('classifyCorrigendum', () => {
  it('names what a corrigendum changed from its own wording', () => {
    expect(classifyCorrigendum({ title: 'Date Extension', description: 'Bid submission end date extended to 10-Oct-2026' })).toEqual(['DEADLINE']);
    expect(classifyCorrigendum({ title: 'Corrigendum', description: 'Revised BOQ and EMD amount' })).toEqual(['BOQ', 'FEE']);
    expect(classifyCorrigendum({ title: null, description: 'Technical specifications amended' })).toEqual(['TECHNICAL_DOCUMENT']);
    expect(classifyCorrigendum({ title: 'Corrigendum 2', description: null })).toEqual([]);
  });

  it('treats only an explicit tender cancellation as a cancellation', () => {
    expect(classifyCorrigendum({ title: 'Cancelled', description: null })).toEqual(['CANCELLATION']);
    expect(classifyCorrigendum({ title: null, description: 'The tender has been cancelled due to administrative reasons' })).toContain('CANCELLATION');
    expect(classifyCorrigendum({ title: null, description: 'Cancellation of the tender' })).toContain('CANCELLATION');
    expect(classifyCorrigendum({ title: null, description: 'Cancellation of corrigendum 2; earlier dates stand' })).not.toContain('CANCELLATION');
  });
});

describe('applying portal corrigenda', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let tenders: TenderRepository;
  let opportunities: OpportunityRepository;

  const tender = (id: string): OpportunityRow => {
    const row = tenders.upsert({
      jobId: jobs.create().id, tenderRef: `REF-${id}`, tenderPortalId: id, title: `Tender ${id}`,
      organisationChain: null, publishedDate: null, closingDate: null, openingDate: null,
      productCategory: 'Information Technology', valueInRupees: 'NA',
    });
    const opportunity = opportunities.recordSighting(row, 'tamil-nadu');
    opportunities.recordScreening(opportunity.id, 'KEEP');
    return opportunity;
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    tenders = new TenderRepository(db);
    opportunities = new OpportunityRepository(db);
  });

  it('records each listed corrigendum once and says what changed since the decision', () => {
    const approved = tender('2026_ELCO_674849_1');
    opportunities.decide([approved.id], 'APPROVE');
    const listing = [
      { portalNumber: '1', title: 'Date Extension', description: 'Closing date extended', publishedAt: '2026-09-20' },
      { portalNumber: '2', title: 'Corrigendum', description: 'Revised BOQ', publishedAt: '2026-09-22' },
    ];
    expect(applyPortalCorrigenda(opportunities, approved.id, listing)).toBe(2);
    expect(applyPortalCorrigenda(opportunities, approved.id, listing)).toBe(0);

    const [changed] = buildInbox(opportunities).changed;
    expect(changed.explanation).toBe('Changed since your decision: Corrigendum 1 (deadline); Corrigendum 2 (BOQ).');
    expect(opportunities.list()).toHaveLength(1);
  });

  it('keeps corrigenda without a portal number from repeating', () => {
    const opportunity = tender('A');
    const listing = [{ portalNumber: null, description: 'Pre-bid clarifications', publishedAt: '2026-09-20' }];
    applyPortalCorrigenda(opportunities, opportunity.id, listing);
    expect(applyPortalCorrigenda(opportunities, opportunity.id, listing)).toBe(0);
  });

  it('cancels a tender the portal withdrew and keeps it visible until the operator notes it', () => {
    const approved = tender('B');
    opportunities.decide([approved.id], 'APPROVE');
    applyPortalCorrigenda(opportunities, approved.id, [{ portalNumber: '1', title: 'Cancelled', publishedAt: '2026-09-23' }]);

    expect(opportunities.getById(approved.id)).toMatchObject({ lifecycle: 'CANCELLED', changed_since_decision: 1 });
    const [changed] = buildInbox(opportunities).changed;
    expect(changed.explanation).toBe('Changed since your decision: Corrigendum 1 (cancellation); cancelled by the portal.');

    opportunities.acknowledgeChanges([approved.id]);
    expect(buildInbox(opportunities).changed).toEqual([]);
    expect(buildTenders(opportunities).closed.map((item) => item.id)).toEqual([approved.id]);
    expect(describeTimeline(opportunities.listEvents(approved.id)).map((entry) => entry.title).slice(-3)).toEqual([
      'Corrigendum 1 published', 'Cancelled by the portal (corrigendum 1)', 'You noted the change and kept your decision',
    ]);
  });

  it('cancels an undecided tender without asking for attention', () => {
    const undecided = tender('C');
    applyPortalCorrigenda(opportunities, undecided.id, [{ portalNumber: '1', description: 'Tender cancelled', publishedAt: null }]);
    expect(opportunities.getById(undecided.id)).toMatchObject({ lifecycle: 'CANCELLED', changed_since_decision: 0 });
    expect(buildInbox(opportunities).attentionCount).toBe(0);
  });

  it('forgets a dismissed retender suggestion and never makes it again', () => {
    const older = tender('D1');
    const newer = tender('D2');
    opportunities.linkPossibleRetender(newer.id, older.id);
    opportunities.dismissRetenderLink(older.id, newer.id);
    opportunities.linkPossibleRetender(newer.id, older.id);
    expect(opportunities.listRetenderLinks()).toEqual([]);
    expect(describeTimeline(opportunities.listEvents(older.id)).at(-1)?.title).toBe('You marked it not related to D2');
  });
});
