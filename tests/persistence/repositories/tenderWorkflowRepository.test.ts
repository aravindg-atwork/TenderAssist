import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';
import { TenderRepository } from '../../../src/persistence/repositories/tenderRepository.js';
import { TenderWorkflowRepository } from '../../../src/persistence/repositories/tenderWorkflowRepository.js';

describe('TenderWorkflowRepository', () => {
  let workflow: TenderWorkflowRepository;
  let tenderId: string;

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const jobId = new JobRepository(db).create().id;
    tenderId = new TenderRepository(db).upsert({
      jobId, tenderRef: 'REF-1', tenderPortalId: 'PORTAL-1', title: 'Web application',
      organisationChain: null, publishedDate: null, closingDate: null, openingDate: null,
      productCategory: 'Software', valueInRupees: 'NA',
    }).id;
    workflow = new TenderWorkflowRepository(db);
  });

  it('upserts manual review decisions', () => {
    workflow.saveReview(tenderId, 'KEEP', 'Matches the delivery scope');
    expect(workflow.getReview(tenderId)).toMatchObject({ decision: 'KEEP', reason: 'Matches the delivery scope' });
    workflow.saveReview(tenderId, 'REJECT', 'Hardware is primary');
    expect(workflow.getReview(tenderId)).toMatchObject({ decision: 'REJECT', reason: 'Hardware is primary' });
  });

  it('tracks document completion and extracted requirements', () => {
    const document = workflow.upsertDocument(tenderId, 'https://tntenders.gov.in/nicgep/file.pdf', 'file.pdf');
    workflow.completeDocument(document.id, 'file.pdf', 'C:\\output\\file.pdf', 'abc123');
    expect(workflow.listDocuments(tenderId)[0]).toMatchObject({ state: 'DOWNLOADED', checksum_sha256: 'abc123' });
    workflow.saveRequirements(tenderId, { emd: 'INR 50000' }, 'MEDIUM');
    expect(workflow.getRequirements(tenderId)).toMatchObject({ confidence: 'MEDIUM' });
  });
});
