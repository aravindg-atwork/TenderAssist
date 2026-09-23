import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishJobWorkbook } from '../../src/publishing/jobPublisher.js';
import type { TenderRow } from '../../src/persistence/repositories/tenderRepository.js';

describe('publishJobWorkbook', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

  it('creates a filterable job workbook with full tender titles', async () => {
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
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(output.workbookPath);
    const sheet = workbook.getWorksheet('Tenders')!;
    expect(sheet.getCell('C2').value).toBe(tender.title);
    expect(sheet.getCell('I2').value).toBe('Information Technology Department');
    expect(sheet.getCell('J2').value).toBe('Tamil Nadu');
    expect(sheet.autoFilter).toBeTruthy();
  });
});
