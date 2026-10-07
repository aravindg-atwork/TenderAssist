import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { TenderWorkflowRepository } from '../../src/persistence/repositories/tenderWorkflowRepository.js';
import { saveTenderFiles } from '../../src/orchestration/postProcessingRunner.js';

describe('saving a tender’s files without a portal page (GeM)', () => {
  it('saves each file, records failures, and does not download a saved file twice', async () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const tenders = new TenderRepository(db);
    const workflow = new TenderWorkflowRepository(db);
    const jobId = new JobRepository(db).create().id;
    const tender = tenders.upsert({
      jobId, tenderRef: 'GEM/2026/B/1', tenderPortalId: '1', title: 'Custom Bid for Services - Portal', organisationChain: null,
      publishedDate: null, closingDate: null, openingDate: null, productCategory: 'Custom Bid for Services', valueInRupees: '',
    });
    tenders.updateDetail(tender.id, {
      organisationChain: null, publishedDate: null, productCategory: null, tenderCategory: null, detailText: 'x',
      documentLinks: [
        { url: 'https://bidplus.gem.gov.in/showbidDocument/1', fileName: 'GeM bid GEM-2026-B-1.pdf' },
        { url: 'https://bidplus.gem.gov.in/resources/upload_nas/a/price.xlsx', fileName: 'Financial price break.xlsx' },
        { url: 'https://bidplus.gem.gov.in/resources/upload_nas/a/gone.pdf', fileName: 'Scope of work.pdf' },
      ],
    });
    const folder = mkdtempSync(join(tmpdir(), 'tenderassist-gem-files-'));
    const asked: string[] = [];
    const downloader = {
      get: async (url: string) => {
        asked.push(url);
        if (url.endsWith('gone.pdf')) throw new Error('GeM returned HTTP 404.');
        return { finalUrl: url, contentType: url.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf', body: Buffer.from(`file ${url}`) };
      },
    };

    const row = tenders.getById(tender.id)!;
    await saveTenderFiles(workflow, row, folder, downloader);
    const documents = workflow.listDocuments(tender.id);
    expect(documents.map((document) => [document.file_name, document.state]).sort()).toEqual([
      ['Financial price break.xlsx', 'DOWNLOADED'],
      ['GeM bid GEM-2026-B-1.pdf', 'DOWNLOADED'],
      ['Scope of work.pdf', 'FAILED'],
    ]);
    expect(readFileSync(join(folder, 'GeM bid GEM-2026-B-1.pdf'), 'utf8')).toBe('file https://bidplus.gem.gov.in/showbidDocument/1');

    // Again: only the failed file is tried.
    asked.length = 0;
    await saveTenderFiles(workflow, row, folder, downloader);
    expect(asked).toEqual(['https://bidplus.gem.gov.in/resources/upload_nas/a/gone.pdf']);
  });
});
