import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';
import { TenderRepository, type TenderRow } from '../../../src/persistence/repositories/tenderRepository.js';
import { OpportunityRepository } from '../../../src/persistence/repositories/opportunityRepository.js';
import { IllegalOpportunityTransitionError } from '../../../src/state/opportunityLifecycle.js';

describe('OpportunityRepository', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let tenders: TenderRepository;
  let repo: OpportunityRepository;

  const sighting = (overrides: Partial<{ tenderPortalId: string | null; tenderRef: string; title: string; closingDate: string | null; valueInRupees: string }> = {}): TenderRow => {
    const job = jobs.create();
    return tenders.upsert({
      jobId: job.id,
      tenderRef: overrides.tenderRef ?? 'ELCOT/IT/2026/12',
      tenderPortalId: overrides.tenderPortalId === undefined ? '2026_ELCO_674849_1' : overrides.tenderPortalId,
      title: overrides.title ?? 'Citizen portal development',
      organisationChain: 'ELCOT',
      publishedDate: '2026-09-20',
      closingDate: overrides.closingDate ?? null,
      openingDate: null,
      productCategory: 'Information Technology',
      valueInRupees: overrides.valueInRupees ?? 'NA',
    });
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    tenders = new TenderRepository(db);
    repo = new OpportunityRepository(db);
  });

  it('normalises identity from the Tender ID, falling back to the reference number', () => {
    expect(OpportunityRepository.identityKey(' 2026_elco_674849_1 ', 'REF')).toBe('2026_ELCO_674849_1');
    expect(OpportunityRepository.identityKey(null, ' elcot / it   12 ')).toBe('ELCOT / IT 12');
  });

  it('creates one opportunity per Tender ID and links every sighting to it', () => {
    const first = sighting();
    const second = sighting();
    const a = repo.recordSighting(first, 'tamil-nadu');
    const b = repo.recordSighting(second, 'tamil-nadu');
    expect(b.id).toBe(a.id);
    expect(b.lifecycle).toBe('NEW');
    expect(b.latest_sighting_id).toBe(second.id);
    expect(db.prepare('SELECT opportunity_id FROM tenders WHERE id = ?').get(first.id)).toEqual({ opportunity_id: a.id });
    expect(repo.listEvents(a.id).map((event) => event.kind)).toEqual(['SEEN', 'SEEN']);
  });

  it('keeps the same Tender ID on different portals apart', () => {
    const a = repo.recordSighting(sighting(), 'tamil-nadu');
    const b = repo.recordSighting(sighting(), 'kerala');
    expect(a.id).not.toBe(b.id);
  });

  it('logs changed fields and flags a decided tender for another look', () => {
    const opportunity = repo.recordSighting(sighting({ closingDate: '01-Oct-2026 03:00 PM' }), 'tamil-nadu');
    expect(opportunity.closing_at).toBe('2026-10-01T09:30:00.000Z');
    repo.recordScreening(opportunity.id, 'KEEP');
    repo.decide([opportunity.id], 'APPROVE');

    const updated = repo.recordSighting(sighting({ closingDate: '08-Oct-2026 03:00 PM', valueInRupees: '500000' }), 'tamil-nadu');
    expect(updated.changed_since_decision).toBe(1);
    expect(updated.lifecycle).toBe('APPROVED');
    const changed = repo.listEvents(opportunity.id).find((event) => event.kind === 'CHANGED')!;
    expect(JSON.parse(changed.data_json).changes).toEqual({
      closing_date: { from: '01-Oct-2026 03:00 PM', to: '08-Oct-2026 03:00 PM' },
      value_in_rupees: { from: null, to: '500000' },
    });

    expect(repo.decide([opportunity.id], 'APPROVE')[0].changed_since_decision).toBe(0);
  });

  it('does not treat a missing value on a later sighting as a change', () => {
    const opportunity = repo.recordSighting(sighting({ valueInRupees: '500000' }), 'tamil-nadu');
    repo.recordSighting(sighting({ valueInRupees: 'NA' }), 'tamil-nadu');
    expect(repo.getById(opportunity.id)?.value_in_rupees).toBe('500000');
    expect(repo.listEvents(opportunity.id).some((event) => event.kind === 'CHANGED')).toBe(false);
  });

  it('records an automatic reject as a recommendation, not a decision', () => {
    const opportunity = repo.recordSighting(sighting(), 'tamil-nadu');
    const screened = repo.recordScreening(opportunity.id, 'REJECT', {}, { reasonCode: 'EXCLUDED_KEYWORD' });
    expect(screened.lifecycle).toBe('SCREENED');
    expect(screened.recommendation).toBe('REJECT');
  });

  it('applies bulk decisions atomically and records the operator as actor', () => {
    const a = repo.recordSighting(sighting({ tenderPortalId: 'A' }), 'tamil-nadu');
    const b = repo.recordSighting(sighting({ tenderPortalId: 'B' }), 'tamil-nadu');
    repo.decide([a.id, b.id], 'APPROVE', { note: '  strong   fit ' });
    const approved = repo.listEvents(a.id).find((event) => event.kind === 'APPROVED')!;
    expect(approved).toMatchObject({ actor: 'operator', note: 'strong fit' });

    repo.decide([b.id], 'REJECT');
    repo.markDocumentsCollected(a.id);
    // DOCUMENTS_COLLECTED -> DEFERRED is illegal, so neither tender changes.
    expect(() => repo.decide([b.id, a.id], 'DEFER')).toThrow(IllegalOpportunityTransitionError);
    expect(repo.getById(b.id)?.lifecycle).toBe('REJECTED');
    expect(repo.getById(a.id)?.lifecycle).toBe('DOCUMENTS_COLLECTED');
  });

  it('moves an automatic reject back to review', () => {
    const opportunity = repo.recordSighting(sighting(), 'tamil-nadu');
    repo.recordScreening(opportunity.id, 'REJECT');
    repo.decide([opportunity.id], 'REJECT');
    expect(repo.decide([opportunity.id], 'REOPEN')[0].lifecycle).toBe('SCREENED');
  });

  it('stores a corrigendum on the same tender without creating another one', () => {
    const opportunity = repo.recordSighting(sighting(), 'tamil-nadu');
    repo.decide([opportunity.id], 'APPROVE');
    const after = repo.recordCorrigendum(opportunity.id, { portalNumber: '3', publishedAt: '2026-09-25', changes: ['DEADLINE', 'BOQ'] });
    expect(after.changed_since_decision).toBe(1);
    expect(repo.list()).toHaveLength(1);
    const event = repo.listEvents(opportunity.id).find((e) => e.kind === 'CORRIGENDUM')!;
    expect(JSON.parse(event.data_json)).toMatchObject({ portalNumber: '3', changes: ['DEADLINE', 'BOQ'] });
  });

  it('records each portal corrigendum number once, however often the list is read', () => {
    const opportunity = repo.recordSighting(sighting(), 'tamil-nadu');
    repo.decide([opportunity.id], 'APPROVE');
    repo.recordCorrigendum(opportunity.id, { portalNumber: '1', publishedAt: '2026-09-20', changes: ['DEADLINE'] });
    repo.decide([opportunity.id], 'APPROVE');
    const again = repo.recordCorrigendum(opportunity.id, { portalNumber: ' 1 ', publishedAt: '2026-09-20', changes: ['DEADLINE'] });
    expect(again.changed_since_decision).toBe(0);
    repo.recordCorrigendum(opportunity.id, { portalNumber: '2', publishedAt: '2026-09-22', changes: ['BOQ'] });
    const numbers = repo.listEvents(opportunity.id).filter((e) => e.kind === 'CORRIGENDUM').map((e) => JSON.parse(e.data_json).portalNumber);
    expect(numbers).toEqual(['1', '2']);
  });

  it('links a possible retender without merging and only once', () => {
    const original = repo.recordSighting(sighting({ tenderPortalId: '2026_ELCO_1_1' }), 'tamil-nadu');
    const retender = repo.recordSighting(sighting({ tenderPortalId: '2026_ELCO_2_1' }), 'tamil-nadu');
    repo.linkPossibleRetender(retender.id, original.id);
    repo.linkPossibleRetender(retender.id, original.id);
    expect(repo.listLinks(original.id)).toHaveLength(1);
    expect(repo.list()).toHaveLength(2);
  });

  it('expires open tenders past their closing time but leaves decided-closed ones alone', () => {
    const open = repo.recordSighting(sighting({ tenderPortalId: 'OPEN', closingDate: '01-Sep-2026 05:00 PM' }), 'tamil-nadu');
    const rejected = repo.recordSighting(sighting({ tenderPortalId: 'REJ', closingDate: '01-Sep-2026 05:00 PM' }), 'tamil-nadu');
    const future = repo.recordSighting(sighting({ tenderPortalId: 'FUT', closingDate: '01-Dec-2026 05:00 PM' }), 'tamil-nadu');
    repo.decide([rejected.id], 'REJECT');

    expect(repo.expireOverdue(new Date('2026-09-24T00:00:00Z'))).toBe(1);
    expect(repo.getById(open.id)?.lifecycle).toBe('EXPIRED');
    expect(repo.getById(rejected.id)?.lifecycle).toBe('REJECTED');
    expect(repo.getById(future.id)?.lifecycle).toBe('NEW');
  });

  it('scopes every read to its workspace', () => {
    const opportunity = repo.recordSighting(sighting(), 'tamil-nadu');
    const other = new OpportunityRepository(db, 'another-bidder');
    expect(other.getById(opportunity.id)).toBeUndefined();
    expect(other.list()).toEqual([]);
  });
});
