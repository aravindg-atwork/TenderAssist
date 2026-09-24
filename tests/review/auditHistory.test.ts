import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { OpportunityRepository } from '../../src/persistence/repositories/opportunityRepository.js';
import { SearchRepository } from '../../src/persistence/repositories/searchRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { TenderWorkflowRepository } from '../../src/persistence/repositories/tenderWorkflowRepository.js';
import { AuthSessionRepository } from '../../src/persistence/repositories/authSessionRepository.js';
import { collectAuditHistory, writeAuditWorkbook } from '../../src/review/auditHistory.js';

describe('audit history', () => {
  let directory: string | null = null;
  afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = null; });

  function seeded() {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const job = new JobRepository(db).create();
    const transitions = new StateTransitionRepository(db);
    transitions.record('JOB', job.id, 'CREATED', 'SEARCHING', undefined, '2026-09-24T04:00:00.000Z');
    const session = new AuthSessionRepository(db).create(job.id);
    transitions.record('AUTH_SESSION', session.id, 'WAITING', 'AUTHENTICATED', 'DSC sign-in confirmed', '2026-09-24T03:59:00.000Z');
    const searches = new SearchRepository(db);
    const search = searches.create(job.id, 'it', 'Information Technology');
    searches.updateProgress(search.id, 2, 17);
    const tender = new TenderRepository(db).upsert({
      jobId: job.id, tenderRef: 'REF/1', tenderPortalId: '2026_ELCO_1_1', title: 'District web portal',
      organisationChain: null, publishedDate: null, closingDate: null, openingDate: null,
      productCategory: 'Information Technology', valueInRupees: 'NA',
    });
    const opportunities = new OpportunityRepository(db);
    const opportunity = opportunities.recordSighting(tender, 'tamil-nadu', { jobId: job.id, at: '2026-09-24T04:01:00.000Z' });
    opportunities.decide([opportunity.id], 'APPROVE', { note: 'Fits our web practice', at: '2026-09-24T05:00:00.000Z' });
    const workflow = new TenderWorkflowRepository(db);
    const document = workflow.upsertDocument(tender.id, 'https://portal.example/doc', 'NIT.pdf');
    workflow.completeDocument(document.id, 'NIT.pdf', 'Sep/24/01_District/NIT.pdf', 'abc123');
    return { db, jobId: job.id };
  }

  it('merges tender, run, sign-in, search, and document records in time order', () => {
    const { db, jobId } = seeded();
    const entries = collectAuditHistory(db);
    expect(entries.map((entry) => entry.area)).toEqual(['Sign-in', 'Run', 'Tender', 'Tender', 'Search', 'Document']);
    expect(entries[0]).toMatchObject({ what: 'Portal sign-in: WAITING → AUTHENTICATED', detail: 'DSC sign-in confirmed', jobId });
    expect(entries[3]).toMatchObject({ who: 'Operator', tenderId: '2026_ELCO_1_1', what: 'You approved it', detail: 'Fits our web practice' });
    expect(entries[4]).toMatchObject({ what: 'Searched “Information Technology”: pending', detail: '17 results, 2 pages read' });
    expect(entries[5]).toMatchObject({ what: 'Downloaded: NIT.pdf', detail: 'SHA-256 abc123', tenderId: '2026_ELCO_1_1' });
  });

  it('writes a filterable workbook with one row per entry', async () => {
    const { db } = seeded();
    directory = mkdtempSync(join(tmpdir(), 'audit-'));
    const file = join(directory, 'audit.xlsx');
    await writeAuditWorkbook(collectAuditHistory(db), file);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const sheet = workbook.getWorksheet('Audit history')!;
    expect(sheet.rowCount).toBe(7);
    expect(sheet.getRow(1).getCell(5).value).toBe('What happened');
    expect(sheet.getRow(5).getCell(5).value).toBe('You approved it');
    expect(sheet.getRow(5).getCell(9).value).toBe('2026-09-24T05:00:00.000Z');
  });
});
