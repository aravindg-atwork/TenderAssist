import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { folderTitle, jobOutputDirectory, mirrorReportSheetsToDrive, mirrorTenderFolderToDrive, publishJobWorkbook, tenderOutputDirectory } from '../../src/publishing/jobPublisher.js';
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
    // The office's own columns, in its order.
    expect(sheet.getRow(1).values).toEqual([undefined, 'SI No', 'TDR Number', 'Department', 'Location', 'Tender Title (short)',
      'Project Nature', 'Tender Value', 'Bid Start Date', 'Bid End Date', 'EMD', 'Pre-bid Meeting Date', 'Eligibility',
      'Eligibility Notes', 'View Tender Link', 'Tender Document Link']);
    expect(sheet.getCell('A2').value).toBe(1);
    expect(sheet.getCell('B2').value).toBe('PORTAL-1');
    expect(sheet.getCell('C2').value).toBe('Information Technology Department');
    expect(sheet.getCell('D2').value).toBe('Tamil Nadu');
    expect(sheet.getCell('E2').value).toBe(tender.title);
    expect(sheet.getCell('F2').value).toBe('Application Dev');
    expect(sheet.getCell('H2').value).toBe('22-09-2026');
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

describe('mirrorTenderFolderToDrive', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

  it('copies one approved tender folder to the same place under the Drive root', () => {
    const local = mkdtempSync(join(tmpdir(), 'tenderassist-local-')); dirs.push(local);
    const drive = mkdtempSync(join(tmpdir(), 'tenderassist-drive-')); dirs.push(drive);
    const approved = join(local, '09-2026', '23-09-2026', '23-09-2026_1_Approved');
    const other = join(local, '09-2026', '23-09-2026', '23-09-2026_2_Not decided');
    mkdirSync(join(approved, 'Documents'), { recursive: true });
    mkdirSync(other, { recursive: true });
    writeFileSync(join(approved, 'Documents', 'tender.zip'), 'zip');

    const destination = mirrorTenderFolderToDrive(approved, local, drive);

    expect(destination).toBe(join(drive, '09-2026', '23-09-2026', '23-09-2026_1_Approved'));
    expect(existsSync(join(destination!, 'Documents', 'tender.zip'))).toBe(true);
    expect(existsSync(join(drive, '09-2026', '23-09-2026', '23-09-2026_2_Not decided'))).toBe(false);
  });

  it('does nothing without a Drive folder and refuses folders outside the output root', () => {
    const local = mkdtempSync(join(tmpdir(), 'tenderassist-local-')); dirs.push(local);
    expect(mirrorTenderFolderToDrive(join(local, 'x'), local, '  ')).toBeNull();
    expect(() => mirrorTenderFolderToDrive(tmpdir(), local, join(local, 'drive'))).toThrow(/outside/);
  });
});

describe('copying a day to Drive', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

  it('puts the approved tender folder and the day report sheet in the same places as on this computer', async () => {
    const local = mkdtempSync(join(tmpdir(), 'tenderassist-local-')); dirs.push(local);
    const drive = mkdtempSync(join(tmpdir(), 'tenderassist-drive-')); dirs.push(drive);
    const tender = {
      id: 't1', job_id: 'job-1', tender_ref: 'GEM/2026/B/8085066', tender_portal_id: '9900001',
      title: 'Custom Bid for Services - Integrated Mobile Application for the WDRA 2 Web Portal',
      organisation_chain: null, published_date: '2026-10-06T11:00:00+05:30', closing_date: '27-Oct-2026 03:00 PM',
      department: 'WDRA', state_name: null, opening_date: null, product_category: 'Custom Bid for Services', value_in_rupees: '',
      favorited: 0, favorited_at: null, detail_product_category: null, tender_category: null, detail_text: null,
      detail_reviewed_at: null, document_links_json: '[]', created_at: '', updated_at: '',
    } satisfies TenderRow;
    const output = await publishJobWorkbook(local, '2026-10-06', 'job-1', [{ tender, automaticDecision: 'KEEP', documents: [], serialNumber: 1 }]);
    const tenderFolder = tenderOutputDirectory(output.jobDirectory, tender, 1);
    mkdirSync(join(tenderFolder, 'Documents'), { recursive: true });
    writeFileSync(join(tenderFolder, 'Documents', 'GeM bid GEM-2026-B-8085066.pdf'), 'pdf');

    mirrorTenderFolderToDrive(tenderFolder, local, drive);
    const copied = mirrorReportSheetsToDrive(output.jobDirectory, local, drive, 'Approved-Tenders-06-10-2026.xlsx');

    const day = join(drive, '10-2026', '06-10-2026');
    expect(copied).toEqual([join(day, 'Approved-Tenders-06-10-2026.xlsx')]);
    expect(existsSync(join(day, 'Approved-Tenders-06-10-2026.xlsx'))).toBe(true);
    const driveTender = join(day, '06-10-2026_1_Integrated Mobile Application for the WDRA 2 Web Portal');
    expect(existsSync(join(driveTender, 'Eligibility.xlsx'))).toBe(true);
    expect(existsSync(join(driveTender, 'Documents', 'GeM bid GEM-2026-B-8085066.pdf'))).toBe(true);
    // Nothing is copied when no Drive folder is set.
    expect(mirrorReportSheetsToDrive(output.jobDirectory, local, '  ', 'Approved-Tenders-06-10-2026.xlsx')).toEqual([]);
  });
});

describe('tender folder names', () => {
  it('drop GeM’s "Custom Bid for Services -" and stay short, but keep finding folders saved under the old full name', () => {
    expect(folderTitle('Custom Bid for Services - Integrated Mobile Application for the WDRA 2 Web Portal')).toBe('Integrated Mobile Application for the WDRA 2 Web Portal');
    expect(folderTitle('x'.repeat(200))).toHaveLength(80);
    const day = mkdtempSync(join(tmpdir(), 'tenderassist-day-'));
    const tender = { title: 'Custom Bid for Services - Website redesign' } as TenderRow;
    expect(tenderOutputDirectory(day, tender, 2, DEFAULT_OUTPUT_STRUCTURE, '2026-10-06')).toBe(join(day, '06-10-2026_2_Website redesign'));
    mkdirSync(join(day, '06-10-2026_2_Custom Bid for Services - Website redesign'));
    expect(tenderOutputDirectory(day, tender, 2, DEFAULT_OUTPUT_STRUCTURE, '2026-10-06')).toBe(join(day, '06-10-2026_2_Custom Bid for Services - Website redesign'));
    rmSync(day, { recursive: true, force: true });
  });
});
