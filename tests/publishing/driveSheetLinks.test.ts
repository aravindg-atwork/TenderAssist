import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { driveCopyOfSheet, isRelativeLink, linkSegments } from '../../src/publishing/driveSheetLinks.js';

async function sheetWith(path: string, links: Array<{ text: string; hyperlink: string }>): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Approved');
  sheet.addRow(['Tender', 'Documents', 'GeM']);
  for (const link of links) sheet.addRow(['A tender', link, { text: 'View on GeM', hyperlink: 'https://bidplus.gem.gov.in/x' }]);
  await workbook.xlsx.writeFile(path);
}

async function linksIn(path: string): Promise<unknown[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.getWorksheet('Approved')!;
  return sheet.getRows(2, sheet.rowCount - 1)!.map((row) => [row.getCell(2).value, row.getCell(3).value]);
}

describe('report sheets on Google Drive', () => {
  it('tells relative folder links from web links', () => {
    expect(isRelativeLink('01 - Housekeeping/Documents')).toBe(true);
    expect(isRelativeLink('https://drive.google.com/drive/folders/x')).toBe(false);
    expect(isRelativeLink('#Sheet1!A1')).toBe(false);
    expect(linkSegments('01%20-%20Housekeeping/Documents')).toEqual(['01 - Housekeeping', 'Documents']);
  });

  it('links the tender folders on Drive, marks ones not there, and reuses the copy while nothing changed', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ta-drive-sheet-'));
    const source = join(directory, 'Approved.xlsx');
    const cache = join(directory, 'cache');
    await sheetWith(source, [
      { text: 'Open documents', hyperlink: '01 - Housekeeping/Documents' },
      { text: 'Open documents', hyperlink: '02 - Security/Documents' },
    ]);
    const asked: string[] = [];
    const resolve = async (target: string) => { asked.push(target); return target.startsWith('01') ? 'https://drive.google.com/drive/folders/abc' : null; };

    const copy = await driveCopyOfSheet(source, cache, resolve);
    expect(copy).not.toBe(source);
    expect(await linksIn(copy)).toEqual([
      [{ text: 'Open documents', hyperlink: 'https://drive.google.com/drive/folders/abc' }, { text: 'View on GeM', hyperlink: 'https://bidplus.gem.gov.in/x' }],
      ['Open documents (on this computer only)', { text: 'View on GeM', hyperlink: 'https://bidplus.gem.gov.in/x' }],
    ]);
    expect(asked).toEqual(['01 - Housekeeping/Documents', '02 - Security/Documents']);
    expect(await driveCopyOfSheet(source, cache, resolve)).toBe(copy);
    expect(readdirSync(cache)).toHaveLength(1);
  });

  it('uploads a sheet with no folder links as it is', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ta-drive-sheet-'));
    const source = join(directory, 'Approved.xlsx');
    await sheetWith(source, []);
    expect(await driveCopyOfSheet(source, join(directory, 'cache'), async () => null)).toBe(source);
  });
});
