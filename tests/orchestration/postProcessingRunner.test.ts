import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../src/persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { ClassificationRepository } from '../../src/persistence/repositories/classificationRepository.js';
import { TenderWorkflowRepository } from '../../src/persistence/repositories/tenderWorkflowRepository.js';
import { JobStateMachine } from '../../src/state/jobStateMachine.js';
import { runPostProcessing } from '../../src/orchestration/postProcessingRunner.js';
import type { RunConfiguration } from '../../src/config/runConfiguration.js';

const PORTAL_URL = 'https://tntenders.gov.in/nicgep/app';

function fakePage(): Page {
  return {
    context: () => ({
      request: {
        get: async () => ({
          ok: () => true,
          status: () => 200,
          body: async () => Buffer.from('%PDF-1.4 fake tender document'),
          headers: () => ({ 'content-type': 'application/pdf' }),
        }),
      },
    }),
  } as unknown as Page;
}

describe('runPostProcessing tender selection', () => {
  it('only acquires documents for tenders the caller explicitly selected, even when another tender is also an automatic KEEP', async () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const jobs = new JobRepository(db);
    const sessions = new AuthSessionRepository(db);
    const transitions = new StateTransitionRepository(db);
    const jobMachine = new JobStateMachine(db, jobs, transitions);
    const tenders = new TenderRepository(db);
    const classifications = new ClassificationRepository(db);
    const workflow = new TenderWorkflowRepository(db);

    const job = jobs.create();
    jobMachine.transition(job.id, 'AUTH_REQUIRED');
    jobMachine.transition(job.id, 'AUTH_PENDING');
    jobMachine.transition(job.id, 'AUTHENTICATED');
    jobMachine.transition(job.id, 'SEARCHING');
    jobMachine.transition(job.id, 'CLASSIFYING');
    jobMachine.transition(job.id, 'SHORTLISTED');
    const session = sessions.create(job.id);

    const selected = tenders.upsert({
      jobId: job.id,
      tenderRef: 'REF-SELECTED',
      tenderPortalId: '2026_SELECTED',
      title: 'Selected tender',
      organisationChain: 'Dept A',
      publishedDate: '2026-09-23',
      closingDate: null,
      openingDate: null,
      productCategory: 'Information Technology',
      valueInRupees: 'NA',
    });
    const skipped = tenders.upsert({
      jobId: job.id,
      tenderRef: 'REF-SKIPPED',
      tenderPortalId: '2026_SKIPPED',
      title: 'Skipped tender',
      organisationChain: 'Dept B',
      publishedDate: '2026-09-23',
      closingDate: null,
      openingDate: null,
      productCategory: 'Information Technology',
      valueInRupees: 'NA',
    });

    for (const tender of [selected, skipped]) {
      tenders.updateDetail(tender.id, {
        organisationChain: tender.organisation_chain,
        productCategory: tender.product_category,
        tenderCategory: 'Services',
        publishedDate: tender.published_date,
        detailText: 'Scope of work: build a citizen portal.',
        documentLinks: [{ url: `${PORTAL_URL}/download/${tender.tender_ref}.pdf`, fileName: `${tender.tender_ref}.pdf` }],
      });
      for (const gate of ['G1', 'G2', 'G3', 'G4'] as const) {
        classifications.saveGate({ tenderId: tender.id, gate, result: 'PASS', reasonCode: 'TEST', evidence: {}, classifierVersion: 'test' });
      }
    }
    // Both tenders are automatic KEEPs -- the old behaviour would have
    // acquired documents for both. Only `selected` is passed explicitly.
    expect(classifications.getFinalForTender(selected.id)).toBe('KEEP');
    expect(classifications.getFinalForTender(skipped.id)).toBe('KEEP');

    const outputRoot = mkdtempSync(join(tmpdir(), 'tenderassist-postprocessing-test-'));
    const config: RunConfiguration = {
      searchDate: '2026-09-23',
      productCategories: ['Information Technology'],
      keywords: [],
      excludedKeywords: [],
    };

    const result = await runPostProcessing(
      { jobs, sessions, jobMachine, tenders, classifications, workflow, signal: undefined },
      fakePage(),
      job.id,
      session.id,
      config,
      outputRoot,
      () => {},
      '',
      PORTAL_URL,
      [selected.id]
    );

    expect(result.outcome).toBe('SUCCESS');
    expect(jobs.getById(job.id)?.state).toBe('COMPLETE');

    const selectedDocuments = workflow.listDocuments(selected.id);
    const skippedDocuments = workflow.listDocuments(skipped.id);
    expect(selectedDocuments).toHaveLength(1);
    expect(selectedDocuments[0].state).toBe('DOWNLOADED');
    expect(skippedDocuments).toHaveLength(0);

    const jobDirectory = readdirSync(outputRoot, { recursive: true }) as string[];
    expect(jobDirectory.some((entry) => entry.includes('REF-SELECTED'))).toBe(true);
    expect(jobDirectory.some((entry) => entry.includes('REF-SKIPPED'))).toBe(false);
  });

  it('publishes the full audit workbook and completes even when the user selects nothing', async () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const jobs = new JobRepository(db);
    const sessions = new AuthSessionRepository(db);
    const transitions = new StateTransitionRepository(db);
    const jobMachine = new JobStateMachine(db, jobs, transitions);
    const tenders = new TenderRepository(db);
    const classifications = new ClassificationRepository(db);
    const workflow = new TenderWorkflowRepository(db);

    const job = jobs.create();
    jobMachine.transition(job.id, 'AUTH_REQUIRED');
    jobMachine.transition(job.id, 'AUTH_PENDING');
    jobMachine.transition(job.id, 'AUTHENTICATED');
    jobMachine.transition(job.id, 'SEARCHING');
    jobMachine.transition(job.id, 'CLASSIFYING');
    jobMachine.transition(job.id, 'SHORTLISTED');
    const session = sessions.create(job.id);

    const outputRoot = mkdtempSync(join(tmpdir(), 'tenderassist-postprocessing-test-'));
    const config: RunConfiguration = {
      searchDate: '2026-09-23',
      productCategories: ['Information Technology'],
      keywords: [],
      excludedKeywords: [],
    };

    const result = await runPostProcessing(
      { jobs, sessions, jobMachine, tenders, classifications, workflow, signal: undefined },
      fakePage(),
      job.id,
      session.id,
      config,
      outputRoot,
      () => {},
      '',
      PORTAL_URL,
      []
    );

    expect(result.outcome).toBe('SUCCESS');
    expect(jobs.getById(job.id)?.state).toBe('COMPLETE');
    expect(existsSync(outputRoot)).toBe(true);
  });
});
