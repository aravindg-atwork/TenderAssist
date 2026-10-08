import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import type { Page } from 'playwright-core';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../src/persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { ClassificationRepository } from '../../src/persistence/repositories/classificationRepository.js';
import { TenderWorkflowRepository } from '../../src/persistence/repositories/tenderWorkflowRepository.js';
import { JobOutputRepository } from '../../src/persistence/repositories/jobOutputRepository.js';
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
          url: () => 'https://tntenders.gov.in/nicgep/app/download/document.pdf',
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
    db.prepare('UPDATE jobs SET created_at = ? WHERE id = ?').run('2026-09-23T06:00:00.000Z', job.id);
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
      { jobs, sessions, jobMachine, tenders, classifications, workflow, outputs: new JobOutputRepository(db), signal: undefined },
      fakePage(),
      job.id,
      session.id,
      config,
      outputRoot,
      () => {},
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

    const outputEntries = readdirSync(outputRoot, { recursive: true }) as string[];
    expect(outputEntries.some((entry) => entry.includes('23-09-2026_1_Selected tender'))).toBe(true);
    expect(outputEntries.some((entry) => entry.includes('Documents'))).toBe(true);
    expect(outputEntries.some((entry) => entry.includes('Eligibility.xlsx'))).toBe(true);
    expect(outputEntries.some((entry) => entry.includes('Skipped tender'))).toBe(false);

    const workbookPath = join(outputRoot, 'September-2026', '23-09-2026', 'Approved-Tenders-23-09-2026.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const sheet = workbook.getWorksheet('Approved Tenders')!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell('A2').value).toBe(1);
    expect(sheet.getCell('B2').value).toBe('2026_SELECTED');
  });

  it('publishes an empty approved workbook and completes when the user selects nothing', async () => {
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
    db.prepare('UPDATE jobs SET created_at = ? WHERE id = ?').run('2026-09-23T06:00:00.000Z', job.id);
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
      { jobs, sessions, jobMachine, tenders, classifications, workflow, outputs: new JobOutputRepository(db), signal: undefined },
      fakePage(),
      job.id,
      session.id,
      config,
      outputRoot,
      () => {},
      PORTAL_URL,
      []
    );

    expect(result.outcome).toBe('SUCCESS');
    expect(jobs.getById(job.id)?.state).toBe('COMPLETE');
    const workbookPath = join(outputRoot, 'September-2026', '23-09-2026', 'Approved-Tenders-23-09-2026.xlsx');
    expect(existsSync(workbookPath)).toBe(true);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    expect(workbook.getWorksheet('Approved Tenders')?.rowCount).toBe(1);
  });

  it('keeps the output of both jobs that publish on the same day', async () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const jobs = new JobRepository(db);
    const sessions = new AuthSessionRepository(db);
    const transitions = new StateTransitionRepository(db);
    const jobMachine = new JobStateMachine(db, jobs, transitions);
    const tenders = new TenderRepository(db);
    const classifications = new ClassificationRepository(db);
    const workflow = new TenderWorkflowRepository(db);
    const outputs = new JobOutputRepository(db);
    const outputRoot = mkdtempSync(join(tmpdir(), 'tenderassist-sameday-test-'));
    const config: RunConfiguration = {
      searchDate: '2026-09-23', productCategories: ['Information Technology'], keywords: [], excludedKeywords: [],
    };

    for (const title of ['Morning tender', 'Afternoon tender']) {
      const job = jobs.create();
      db.prepare('UPDATE jobs SET created_at = ? WHERE id = ?').run('2026-09-23T06:00:00.000Z', job.id);
      for (const state of ['AUTH_REQUIRED', 'AUTH_PENDING', 'AUTHENTICATED', 'SEARCHING', 'CLASSIFYING', 'SHORTLISTED'] as const) {
        jobMachine.transition(job.id, state);
      }
      const session = sessions.create(job.id);
      const tender = tenders.upsert({
        jobId: job.id, tenderRef: `REF-${title}`, tenderPortalId: `ID-${title}`, title,
        organisationChain: 'Dept', publishedDate: '2026-09-23', closingDate: null, openingDate: null,
        productCategory: 'Information Technology', valueInRupees: 'NA',
      });
      const result = await runPostProcessing(
        { jobs, sessions, jobMachine, tenders, classifications, workflow, outputs, signal: undefined },
        fakePage(), job.id, session.id, config, outputRoot, () => {}, PORTAL_URL, [tender.id]
      );
      expect(result.outcome).toBe('SUCCESS');
    }

    const dayFolder = join(outputRoot, 'September-2026', '23-09-2026');
    const entries = readdirSync(dayFolder);
    expect(entries).toContain('23-09-2026_1_Morning tender');
    expect(entries).toContain('23-09-2026_2_Afternoon tender');
    expect(entries).toContain('Approved-Tenders-23-09-2026.xlsx');
    expect(entries).toContain('Approved-Tenders-23-09-2026 (run 2).xlsx');
  });
});
