import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jobOutputDirectory, publishJobWorkbook, tenderOutputDirectory } from '../../src/publishing/jobPublisher.js';
import type { TenderRow } from '../../src/persistence/repositories/tenderRepository.js';
import { DEFAULT_OUTPUT_STRUCTURE } from '../../src/publishing/outputStructure.js';

describe('publishJobWorkbook', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

  it('creates the month/day hierarchy, approved workbook, and per-tender eligibility sheet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tenderassist-publish-')); dirs.push(root);
    const tender = {
      id: 't1', job_id: 'job-12345678', tender_ref: 'REF-1', tender_portal_id: 'PORTAL-1',
      title: 'Development and maintenance of a complete citizen services web application',
      organisation_chain: 'IT Department', published_date: '2026-09-22', closing_date: '2026-10-01',
      department: 'Information Technology Department', state_name: 'Tamil Nadu',
      opening_date: null, product_category: 'Software', value_in_rupees: '100000', favorited: 1,
      favorited_at: '2026-09-22', detail_product_category: 'Software', tender_category: 'Services',
      detail_text: 'Scope of work', detail_reviewed_at: '2026-09-22', document_links_json: '[]',
      created_at: '2026-09-22', updated_at: '2026-09-22',
    } satisfies TenderRow;
    const output = await publishJobWorkbook(root, '2026-09-22', 'job-12345678', [{
      tender, automaticDecision: 'KEEP', documents: [],
    }]);
    expect(output.jobDirectory).toBe(join(root, '09-2026', '22-09-2026'));
    expect(output.workbookPath).toBe(join(output.jobDirectory, 'Approved-Tenders-22-09-2026.xlsx'));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(output.workbookPath);
    const sheet = workbook.getWorksheet('Approved Tenders')!;
    expect(sheet.getCell('C2').value).toBe(tender.title);
    expect(sheet.getCell('I2').value).toBe('Information Technology Department');
    expect(sheet.getCell('J2').value).toBe('Tamil Nadu');
    expect(sheet.autoFilter).toBeTruthy();

    const tenderDirectory = tenderOutputDirectory(output.jobDirectory, tender, 1);
    expect(tenderDirectory).toContain('22-09-2026_1_Development and maintenance');
    expect(existsSync(join(tenderDirectory, 'Eligibility.xlsx'))).toBe(true);
    const eligibility = new ExcelJS.Workbook();
    await eligibility.xlsx.readFile(join(tenderDirectory, 'Eligibility.xlsx'));
    expect(eligibility.getWorksheet('Eligibility')?.getCell('B4').value).toBe(tender.tender_ref);
  });

  it('keeps a stable date hierarchy without using the job id', () => {
    const root = 'C:\\TenderAssist';
    expect(jobOutputDirectory(root, '2026-01-05', 'job-one')).toBe(join(root, '01-2026', '05-01-2026'));
    expect(jobOutputDirectory(root, '2026-01-05', 'job-two')).toBe(join(root, '01-2026', '05-01-2026'));
  });

  it('applies custom folder and workbook templates without changing the chosen root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tenderassist-custom-publish-')); dirs.push(root);
    const tender = {
      id: 't2', job_id: 'job-custom', tender_ref: 'REF-2', tender_portal_id: 'PORTAL-2',
      title: 'Portal redesign', organisation_chain: null, published_date: null, closing_date: null,
      department: null, state_name: null, opening_date: null, product_category: '',
      value_in_rupees: 'NA', favorited: 1, favorited_at: null, detail_product_category: null,
      tender_category: null, detail_text: null, detail_reviewed_at: null, document_links_json: '[]',
      created_at: '2026-09-24', updated_at: '2026-09-24',
    } satisfies TenderRow;
    const structure = {
      ...DEFAULT_OUTPUT_STRUCTURE,
      monthFolderTemplate: '{YYYY}-{MM}',
      dayFolderTemplate: '{YYYY}.{MM}.{DD}',
      tenderFolderTemplate: '{SNO} - {TITLE}',
      approvedWorkbookTemplate: 'Approved {DD}-{MM}-{YYYY}',
      eligibilityWorkbookTemplate: 'Requirements',
      documentsFolderTemplate: 'Tender documents',
    };
    const output = await publishJobWorkbook(root, '2026-09-24', 'job-custom', [{ tender, automaticDecision: 'KEEP', documents: [] }], structure);
    expect(output.jobDirectory).toBe(join(root, '2026-09', '2026.09.24'));
    expect(output.workbookPath).toBe(join(output.jobDirectory, 'Approved 24-09-2026.xlsx'));
    expect(existsSync(join(output.jobDirectory, '1 - Portal redesign', 'Requirements.xlsx'))).toBe(true);
  });
});
