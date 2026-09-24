import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { TenderRepository, type TenderRow } from '../../src/persistence/repositories/tenderRepository.js';
import { ClassificationRepository } from '../../src/persistence/repositories/classificationRepository.js';
import { TenderWorkflowRepository } from '../../src/persistence/repositories/tenderWorkflowRepository.js';
import { OpportunityRepository } from '../../src/persistence/repositories/opportunityRepository.js';
import {
  applyTenderDecision,
  recordCollectedDocuments,
  recordDownloadSelection,
  syncJobOpportunities,
} from '../../src/orchestration/opportunitySync.js';

describe('opportunity sync', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let tenders: TenderRepository;
  let classifications: ClassificationRepository;
  let workflow: TenderWorkflowRepository;
  let opportunities: OpportunityRepository;
  let deps: { tenders: TenderRepository; classifications: ClassificationRepository; opportunities: OpportunityRepository; workflow: TenderWorkflowRepository };

  const seen = (jobId: string, tenderPortalId: string): TenderRow => tenders.upsert({
    jobId, tenderRef: `REF-${tenderPortalId}`, tenderPortalId, title: `Tender ${tenderPortalId}`,
    organisationChain: null, publishedDate: null, closingDate: null, openingDate: null,
    productCategory: 'Information Technology', valueInRupees: 'NA',
  });
  const passAllGates = (tenderId: string) => {
    for (const gate of ['G1', 'G2', 'G3', 'G4'] as const) {
      classifications.saveGate({ tenderId, gate, result: 'PASS', reasonCode: `${gate}_OK`, evidence: {}, classifierVersion: 'test' });
    }
  };
  const opportunityOf = (tenderId: string) => {
    const { opportunity_id } = db.prepare('SELECT opportunity_id FROM tenders WHERE id = ?').get(tenderId) as { opportunity_id: string };
    return opportunities.getById(opportunity_id)!;
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    tenders = new TenderRepository(db);
    classifications = new ClassificationRepository(db);
    workflow = new TenderWorkflowRepository(db);
    opportunities = new OpportunityRepository(db);
    deps = { tenders, classifications, opportunities, workflow };
  });

  it('records sightings after search and screening only after classification, without duplicates', () => {
    const job = jobs.create();
    const tender = seen(job.id, 'A');
    syncJobOpportunities(deps, job.id, 'tamil-nadu', { screening: false });
    syncJobOpportunities(deps, job.id, 'tamil-nadu', { screening: false });
    expect(opportunityOf(tender.id)).toMatchObject({ lifecycle: 'NEW', recommendation: null });

    passAllGates(tender.id);
    syncJobOpportunities(deps, job.id, 'tamil-nadu', { screening: true });
    syncJobOpportunities(deps, job.id, 'tamil-nadu', { screening: true });
    const opportunity = opportunityOf(tender.id);
    expect(opportunity).toMatchObject({ lifecycle: 'SCREENED', recommendation: 'KEEP' });
    expect(opportunities.listEvents(opportunity.id).map((event) => event.kind)).toEqual(['SEEN', 'SCREENED']);
    const screened = opportunities.listEvents(opportunity.id)[1];
    expect(JSON.parse(screened.data_json).gates).toHaveLength(4);
  });

  it('keeps an approved tender out of review when a later run sees it again', () => {
    const monday = jobs.create();
    const first = seen(monday.id, 'A');
    passAllGates(first.id);
    syncJobOpportunities(deps, monday.id, 'tamil-nadu', { screening: true });
    recordDownloadSelection(deps, monday.id, [first.id]);
    expect(opportunityOf(first.id).lifecycle).toBe('APPROVED');

    const tuesday = jobs.create();
    const again = seen(tuesday.id, 'A');
    passAllGates(again.id);
    syncJobOpportunities(deps, tuesday.id, 'tamil-nadu', { screening: true });
    const opportunity = opportunityOf(again.id);
    expect(opportunity.id).toBe(opportunityOf(first.id).id);
    expect(opportunity.lifecycle).toBe('APPROVED');
    expect(opportunity.latest_sighting_id).toBe(again.id);
  });

  it('marks documents collected only for approved tenders with downloads', () => {
    const job = jobs.create();
    const approved = seen(job.id, 'A');
    const notApproved = seen(job.id, 'B');
    syncJobOpportunities(deps, job.id, 'tamil-nadu', { screening: false });
    recordDownloadSelection(deps, job.id, [approved.id]);
    for (const tender of [approved, notApproved]) {
      const document = workflow.upsertDocument(tender.id, `https://tntenders.gov.in/nicgep/${tender.id}.pdf`, 'doc.pdf');
      workflow.completeDocument(document.id, 'doc.pdf', 'C:\\out\\doc.pdf', 'abc');
    }
    recordCollectedDocuments(deps, job.id);
    expect(opportunityOf(approved.id).lifecycle).toBe('DOCUMENTS_COLLECTED');
    expect(opportunityOf(notApproved.id).lifecycle).toBe('NEW');
  });

  it('ignores a review decision the tender has already moved past', () => {
    const job = jobs.create();
    const tender = seen(job.id, 'A');
    syncJobOpportunities(deps, job.id, 'tamil-nadu', { screening: false });
    const opportunity = opportunityOf(tender.id);
    opportunities.decide([opportunity.id], 'APPROVE');
    opportunities.markDocumentsCollected(opportunity.id);
    applyTenderDecision(deps, opportunity.id, 'APPROVE', { jobId: job.id });
    expect(opportunities.getById(opportunity.id)?.lifecycle).toBe('DOCUMENTS_COLLECTED');
    applyTenderDecision(deps, opportunity.id, 'REJECT', { jobId: job.id, note: 'out of scope' });
    expect(opportunities.getById(opportunity.id)?.lifecycle).toBe('REJECTED');
  });

  describe('releaseJob', () => {
    it('keeps operator decisions, drops untouched tenders, and repoints shared ones', () => {
      const monday = jobs.create();
      const tuesday = jobs.create();
      const decided = seen(monday.id, 'DECIDED');
      const untouched = seen(monday.id, 'UNTOUCHED');
      const shared = seen(monday.id, 'SHARED');
      const sharedAgain = seen(tuesday.id, 'SHARED');
      syncJobOpportunities(deps, monday.id, 'tamil-nadu', { screening: false });
      syncJobOpportunities(deps, tuesday.id, 'tamil-nadu', { screening: false });
      const decidedId = opportunityOf(decided.id).id;
      const untouchedId = opportunityOf(untouched.id).id;
      const sharedId = opportunityOf(shared.id).id;
      db.prepare('UPDATE opportunities SET latest_sighting_id = ? WHERE id = ?').run(shared.id, sharedId);
      opportunities.decide([decidedId], 'APPROVE', { note: 'good fit' });

      opportunities.releaseJob(monday.id);
      tenders.deleteForJob(monday.id);

      expect(opportunities.getById(decidedId)).toMatchObject({ lifecycle: 'APPROVED', latest_sighting_id: null });
      expect(opportunities.listEvents(decidedId).some((event) => event.kind === 'APPROVED' && event.note === 'good fit')).toBe(true);
      expect(opportunities.getById(untouchedId)).toBeUndefined();
      expect(opportunities.listEvents(untouchedId)).toEqual([]);
      expect(opportunities.getById(sharedId)?.latest_sighting_id).toBe(sharedAgain.id);
    });
  });
});
