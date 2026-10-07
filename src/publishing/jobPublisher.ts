import ExcelJS from 'exceljs';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { FinalClassification } from '../persistence/repositories/classificationRepository.js';
import type { TenderDocumentRow, TenderRequirementRow, TenderReviewRow } from '../persistence/repositories/tenderWorkflowRepository.js';
import { DEFAULT_OUTPUT_STRUCTURE, resolveOutputStructure, type OutputStructureSettings } from './outputStructure.js';
import { REPORT_COLUMNS, reportRow } from './reportSheet.js';

export interface PublishableTender {
  tender: TenderRow;
  automaticDecision: FinalClassification;
  manualReview?: TenderReviewRow;
  documents: TenderDocumentRow[];
  requirements?: TenderRequirementRow;
  /** Stable S.No within the day folder; defaults to the item's position. */
  serialNumber?: number;
}

function requirementData(row?: TenderRequirementRow): Record<string, string | null> {
  if (!row) return {};
  try { return JSON.parse(row.data_json) as Record<string, string | null>; }
  catch { return {}; }
}

export function localDateFromTimestamp(timestamp: string | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error('Job creation time is invalid.');
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function jobOutputDirectory(
  outputRoot: string,
  searchDate: string,
  _jobId?: string,
  structure: OutputStructureSettings = DEFAULT_OUTPUT_STRUCTURE
): string {
  const resolved = resolveOutputStructure(structure, searchDate);
  return join(outputRoot, resolved.monthFolder, resolved.dayFolder);
}

function outputDateFromDefaultDirectory(jobDirectory: string): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(basename(jobDirectory));
  if (!match) throw new Error('Output date is required when using a custom day-folder template.');
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * The title part of a tender's folder name: without GeM's "Custom Bid for
 * Services -" and at most 80 characters, so paths stay well inside Windows'
 * 260-character limit for File Explorer, Excel and Drive.
 */
export function folderTitle(title: string): string {
  const clean = title.replace(/^custom bid for services\s*-\s*/i, '').split(/,\s*custom bid for services\s*-\s*/i)[0].replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? clean.slice(0, 80).trimEnd() : clean;
}

/** The tender's folder: its short-title name, or the full-title name an earlier version already saved. */
function tenderFolderName(jobDirectory: string, tender: TenderRow, serialNumber: number, structure: OutputStructureSettings, outputDate: string): string {
  const current = resolveOutputStructure(structure, outputDate, folderTitle(tender.title), serialNumber).tenderFolder;
  const earlier = resolveOutputStructure(structure, outputDate, tender.title, serialNumber).tenderFolder;
  return earlier !== current && !existsSync(join(jobDirectory, current)) && existsSync(join(jobDirectory, earlier)) ? earlier : current;
}

export function tenderOutputDirectory(
  jobDirectory: string,
  tender: TenderRow,
  serialNumber = 1,
  structure: OutputStructureSettings = DEFAULT_OUTPUT_STRUCTURE,
  outputDate = outputDateFromDefaultDirectory(jobDirectory)
): string {
  return join(jobDirectory, tenderFolderName(jobDirectory, tender, serialNumber, structure, outputDate));
}

export function tenderDocumentsDirectory(
  jobDirectory: string,
  tender: TenderRow,
  serialNumber = 1,
  structure: OutputStructureSettings = DEFAULT_OUTPUT_STRUCTURE,
  outputDate = outputDateFromDefaultDirectory(jobDirectory)
): string {
  const resolved = resolveOutputStructure(structure, outputDate, tender.title, serialNumber);
  return join(jobDirectory, tenderFolderName(jobDirectory, tender, serialNumber, structure, outputDate), resolved.documentsFolder);
}

async function publishTenderEligibilityWorkbook(
  tenderDirectory: string,
  item: PublishableTender,
  serialNumber: number,
  structure: OutputStructureSettings,
  outputDate: string
): Promise<void> {
  mkdirSync(tenderDirectory, { recursive: true });
  const req = requirementData(item.requirements);
  const decision = item.manualReview?.decision ?? item.automaticDecision;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TenderAssist';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Eligibility', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Field', key: 'field', width: 28 },
    { header: 'Value', key: 'value', width: 82 },
  ];
  const rows: Array<[string, string | number]> = [
    ['S.No', serialNumber],
    ['Tender ID', item.tender.tender_portal_id ?? item.tender.tender_ref],
    ['Reference', item.tender.tender_ref],
    ['Tender title', item.tender.title],
    ['Approved decision', decision],
    ['Approval source', item.manualReview ? 'Manual review' : 'Automation'],
    ['Review reason', item.manualReview?.reason ?? ''],
    ['Category', item.tender.detail_product_category ?? item.tender.product_category ?? ''],
    ['Organisation', item.tender.organisation_chain ?? ''],
    ['Department', item.tender.department ?? ''],
    ['State', item.tender.state_name ?? ''],
    ['Published date', item.tender.published_date ?? ''],
    ['Closing date', item.tender.closing_date ?? ''],
    ['Estimated value', item.tender.value_in_rupees === 'NA' ? '' : item.tender.value_in_rupees ?? ''],
    ['Scope', req.scope ?? ''],
    ['Eligibility', req.eligibility ?? ''],
    ['EMD', req.emd ?? ''],
    ['Tender fee', req.tenderFee ?? ''],
    ['Submission deadline', req.submissionDeadline ?? ''],
    ['Submission method', req.submissionMethod ?? ''],
    ['Contact', req.contact ?? ''],
    ['Extraction confidence', item.requirements?.confidence ?? ''],
    ['Documents downloaded', item.documents.filter((document) => document.state === 'DOWNLOADED').length],
  ];
  for (const [field, value] of rows) sheet.addRow({ field, value });
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF263B93' } };
  sheet.getColumn(2).alignment = { vertical: 'top', wrapText: true };
  const fileName = resolveOutputStructure(structure, outputDate, folderTitle(item.tender.title), serialNumber).eligibilityWorkbook;
  await workbook.xlsx.writeFile(join(tenderDirectory, fileName));
}

/** Later jobs sharing a day folder get their own workbook instead of replacing the first. */
export function approvedWorkbookName(fileName: string, runNumber: number): string {
  return runNumber > 1 ? fileName.replace(/\.xlsx$/i, ` (run ${runNumber}).xlsx`) : fileName;
}

export async function publishJobWorkbook(
  outputRoot: string,
  searchDate: string,
  jobId: string,
  items: PublishableTender[],
  structure: OutputStructureSettings = DEFAULT_OUTPUT_STRUCTURE,
  runNumber = 1,
  /** The website, for tenders with no page of their own to link to. */
  portal?: { url: string; name: string }
): Promise<{ jobDirectory: string; workbookPath: string }> {
  const jobDirectory = jobOutputDirectory(outputRoot, searchDate, jobId, structure);
  mkdirSync(jobDirectory, { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TenderAssist';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Approved Tenders', { views: [{ state: 'frozen', ySplit: 1 }] });
  // The office's own columns, as in its "Tenders Interested" workbook.
  sheet.columns = REPORT_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.width }));

  for (const [index, item] of items.entries()) {
    const serialNumber = item.serialNumber ?? index + 1;
    const req = requirementData(item.requirements);
    const tenderDirectory = tenderOutputDirectory(jobDirectory, item.tender, serialNumber, structure, searchDate);
    const documentsDirectory = tenderDocumentsDirectory(jobDirectory, item.tender, serialNumber, structure, searchDate);
    const row = reportRow({
      tender: item.tender,
      serialNumber,
      eligibility: req.eligibility,
      emd: req.emd,
      portalUrl: portal?.url,
      portalName: portal?.name,
      // Relative, so the link also works in the copy on Drive.
      documentsFolder: item.documents.some((document) => document.state === 'DOWNLOADED')
        ? relative(jobDirectory, documentsDirectory).split(sep).join('/')
        : undefined,
    });
    sheet.addRow({
      ...row,
      viewTenderLink: row.viewTenderLink ? { text: row.viewTenderLink.text, hyperlink: row.viewTenderLink.target } : '',
      tenderDocumentLink: row.tenderDocumentLink ? { text: row.tenderDocumentLink.text, hyperlink: row.tenderDocumentLink.target } : '',
    });
    await publishTenderEligibilityWorkbook(tenderDirectory, item, serialNumber, structure, searchDate);
  }

  const lastColumn = String.fromCharCode('A'.charCodeAt(0) + REPORT_COLUMNS.length - 1);
  sheet.autoFilter = { from: 'A1', to: `${lastColumn}1` };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF263B93' } };
  sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  for (const row of items.length > 0 ? sheet.getRows(2, items.length) ?? [] : []) {
    row.alignment = { vertical: 'top', wrapText: true };
    for (const key of ['viewTenderLink', 'tenderDocumentLink'] as const) {
      const cell = row.getCell(key);
      if (cell.value) cell.font = { color: { argb: 'FF1F4E9E' }, underline: true };
    }
  }
  const workbookPath = join(jobDirectory, approvedWorkbookName(resolveOutputStructure(structure, searchDate).approvedWorkbook, runNumber));
  await workbook.xlsx.writeFile(workbookPath);
  return { jobDirectory, workbookPath };
}

/**
 * Copies one tender's saved folder (documents and eligibility sheet) to the
 * same relative place under the Drive root. Returns the Drive folder, or null
 * when Drive is not configured.
 */
export function mirrorTenderFolderToDrive(localTenderDirectory: string, localOutputRoot: string, driveOutputRoot: string): string | null {
  const driveRoot = driveOutputRoot.trim();
  if (!driveRoot) return null;
  const relativePath = relative(resolve(localOutputRoot), resolve(localTenderDirectory));
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('The tender folder is outside the local output folder.');
  }
  const destination = join(driveRoot, relativePath);
  if (resolve(destination).toLocaleLowerCase() === resolve(localTenderDirectory).toLocaleLowerCase()) return destination;
  mkdirSync(destination, { recursive: true });
  cpSync(localTenderDirectory, destination, { recursive: true, force: true });
  return destination;
}

/**
 * Copies the day's report sheet(s) to the same relative place under the Drive
 * root, so Drive has the sheet next to the approved tenders' folders. Returns
 * the files copied.
 */
export function mirrorReportSheetsToDrive(localJobDirectory: string, localOutputRoot: string, driveOutputRoot: string, approvedWorkbookFileName: string): string[] {
  const driveRoot = driveOutputRoot.trim();
  if (!driveRoot || !existsSync(localJobDirectory)) return [];
  const relativePath = relative(resolve(localOutputRoot), resolve(localJobDirectory));
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('The day folder is outside the local output folder.');
  }
  const destination = join(driveRoot, relativePath);
  if (resolve(destination).toLocaleLowerCase() === resolve(localJobDirectory).toLocaleLowerCase()) return [];
  // The first run's sheet and any "(run N)" sheets of later runs on the same day.
  const stem = approvedWorkbookFileName.replace(/\.xlsx$/i, '').toLocaleLowerCase();
  const sheets = readdirSync(localJobDirectory).filter((name) => /\.xlsx$/i.test(name) && name.toLocaleLowerCase().startsWith(stem));
  mkdirSync(destination, { recursive: true });
  return sheets.map((name) => {
    copyFileSync(join(localJobDirectory, name), join(destination, name));
    return join(destination, name);
  });
}

export function mirrorJobOutputToDrive(
  localJobDirectory: string,
  driveOutputRoot: string,
  searchDate: string,
  jobId: string,
  structure: OutputStructureSettings = DEFAULT_OUTPUT_STRUCTURE
): string | null {
  const driveRoot = driveOutputRoot.trim();
  if (!driveRoot) return null;
  const destination = jobOutputDirectory(driveRoot, searchDate, jobId, structure);
  if (resolve(destination).toLocaleLowerCase() === resolve(localJobDirectory).toLocaleLowerCase()) return destination;
  mkdirSync(driveRoot, { recursive: true });
  cpSync(localJobDirectory, destination, { recursive: true, force: true });
  return destination;
}
