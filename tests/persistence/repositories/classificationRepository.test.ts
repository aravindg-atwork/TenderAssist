import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { JobRepository } from '../../../src/persistence/repositories/jobRepository.js';
import { TenderRepository } from '../../../src/persistence/repositories/tenderRepository.js';
import { ClassificationRepository } from '../../../src/persistence/repositories/classificationRepository.js';

describe('ClassificationRepository', () => {
  let repo: ClassificationRepository;
  let tenderId: string;

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const jobId = new JobRepository(db).create().id;
    tenderId = new TenderRepository(db).upsert({
      jobId,
      tenderRef: 'ref-1',
      tenderPortalId: 'id-1',
      title: 'Software portal',
      organisationChain: null,
      publishedDate: null,
      closingDate: null,
      openingDate: null,
      productCategory: 'Information Technology',
      valueInRupees: 'NA',
    }).id;
    repo = new ClassificationRepository(db);
  });

  it('recomputes KEEP only when all four gates pass', () => {
    for (const gate of ['G1', 'G2', 'G3', 'G4'] as const) {
      repo.saveGate({ tenderId, gate, result: 'PASS', reasonCode: 'PASS', evidence: {}, classifierVersion: 'test' });
    }
    expect(repo.getFinalForTender(tenderId)).toBe('KEEP');
  });

  it('uses REJECT over UNCERTAIN and never stores a separate mutable final value', () => {
    repo.saveGate({ tenderId, gate: 'G1', result: 'PASS', reasonCode: 'PASS', evidence: {}, classifierVersion: 'test' });
    repo.saveGate({ tenderId, gate: 'G2', result: 'REJECT', reasonCode: 'NO', evidence: {}, classifierVersion: 'test' });
    repo.saveGate({ tenderId, gate: 'G3', result: 'UNCERTAIN', reasonCode: 'MAYBE', evidence: {}, classifierVersion: 'test' });
    repo.saveGate({ tenderId, gate: 'G4', result: 'PASS', reasonCode: 'PASS', evidence: {}, classifierVersion: 'test' });
    expect(repo.getFinalForTender(tenderId)).toBe('REJECT');
  });
});
