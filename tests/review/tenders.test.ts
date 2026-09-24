import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { OpportunityRepository } from '../../src/persistence/repositories/opportunityRepository.js';
import { buildTenders } from '../../src/review/tenders.js';
import { describeTimeline } from '../../src/review/timeline.js';

describe('Tenders view and timeline', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let tenders: TenderRepository;
  let opportunities: OpportunityRepository;

  const seen = (id: string, closingDate: string | null = null) => {
    const job = jobs.create();
    const tender = tenders.upsert({
      jobId: job.id, tenderRef: `REF-${id}`, tenderPortalId: id, title: `Tender ${id}`, organisationChain: null,
      publishedDate: null, closingDate, openingDate: null, productCategory: 'IT', valueInRupees: 'NA',
    });
    return opportunities.recordSighting(tender, 'tamil-nadu', { jobId: job.id });
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    tenders = new TenderRepository(db);
    opportunities = new OpportunityRepository(db);
  });

  it('groups tenders by lifecycle and leaves Inbox tenders in the Inbox', () => {
    const approved = seen('APPROVED');
    const collected = seen('COLLECTED');
    const deferred = seen('DEFERRED');
    const rejected = seen('REJECTED');
    const hidden = seen('HIDDEN');
    seen('IN_INBOX');
    const expired = seen('EXPIRED', '01-Sep-2026 05:00 PM');
    opportunities.decide([approved.id, collected.id], 'APPROVE');
    opportunities.markDocumentsCollected(collected.id);
    opportunities.decide([deferred.id], 'DEFER');
    opportunities.decide([rejected.id], 'REJECT');
    opportunities.hideFromInbox([hidden.id]);
    opportunities.expireOverdue(new Date('2026-09-24T00:00:00Z'));

    const view = buildTenders(opportunities);
    const ids = (list: { tenderId: string }[]) => list.map((item) => item.tenderId).sort();
    expect(ids(view.approved)).toEqual(['APPROVED', 'COLLECTED']);
    expect(ids(view.deferred)).toEqual(['DEFERRED']);
    expect(ids(view.rejected)).toEqual(['REJECTED']);
    expect(ids(view.earlier)).toEqual(['HIDDEN']);
    expect(ids(view.closed)).toEqual([expired.tender_portal_id]);
  });

  it('describes a tender history in plain language', () => {
    const opportunity = seen('A', '01-Oct-2026 05:00 PM');
    opportunities.recordScreening(opportunity.id, 'KEEP', {}, { gates: [{ gate: 'G3', result: 'PASS', reasonCode: 'X', evidence: { matchedKeywords: ['web portal'] } }] });
    opportunities.decide([opportunity.id], 'APPROVE', { note: 'fits our team' });
    opportunities.recordCorrigendum(opportunity.id, { portalNumber: '2', publishedAt: null, changes: ['DEADLINE', 'TECHNICAL_DOCUMENT'] });
    const job = jobs.create();
    const later = tenders.upsert({
      jobId: job.id, tenderRef: 'REF-A', tenderPortalId: 'A', title: 'Tender A', organisationChain: null,
      publishedDate: null, closingDate: '08-Oct-2026 05:00 PM', openingDate: null, productCategory: 'IT', valueInRupees: 'NA',
    });
    opportunities.recordSighting(later, 'tamil-nadu', { jobId: job.id });

    const timeline = describeTimeline(opportunities.listEvents(opportunity.id));
    expect(timeline.map((entry) => [entry.actor, entry.title, entry.detail])).toEqual([
      ['automation', 'Found by a discovery run', null],
      ['automation', 'Screened: recommended', 'Recommended: matched “web portal”.'],
      ['operator', 'You approved it', 'fits our team'],
      ['automation', 'Corrigendum 2 published', 'Changes: deadline, technical document'],
      ['automation', 'Portal details changed', 'Closing date: 01-Oct-2026 05:00 PM → 08-Oct-2026 05:00 PM'],
      ['automation', 'Found by a discovery run', null],
    ]);
  });
});
