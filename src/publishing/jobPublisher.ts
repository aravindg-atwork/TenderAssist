import ExcelJS from 'exceljs';
import { cpSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { FinalClassification } from '../persistence/repositories/classificationRepository.js';
import type { TenderDocumentRow, TenderRequirementRow, TenderReviewRow } from '../persistence/repositories/tenderWorkflowRepository.js';
import { DEFAULT_OUTPUT_STRUCTURE, resolveOutputStructure, type OutputStructureSettings } from './outputStructure.js';

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

export function tenderOutputDirectory(
  jobDirectory: string,
  tender: TenderRow,
  serialNumber = 1,
  structure: OutputStructureSettings = DEFAULT_OUTPUT_STRUCTURE,
  outputDate = outputDateFromDefaultDirectory(jobDirectory)
): string {
  return join(jobDirectory, resolveOutputStructure(structure, outputDate, tender.title, serialNumber).tenderFolder);
}

export function tenderDocumentsDirectory(
  jobDirectory: string,
  tender: TenderRow,
  serialNumber = 1,
  structure: OutputStructureSettings = DEFAULT_OUTPUT_STRUCTURE,
  outputDate = outputDateFromDefaultDirectory(jobDirectory)
): string {
  const resolved = resolveOutputStructure(structure, outputDate, tender.title, serialNumber);
  return join(jobDirectory, resolved.tenderFolder, resolved.documentsFolder);
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
  const fileName = resolveOutputStructure(structure, outputDate, item.tender.title, serialNumber).eligibilityWorkbook;
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
  runNumber = 1
): Promise<{ jobDirectory: string; workbookPath: string }> {
  const jobDirectory = jobOutputDirectory(outputRoot, searchDate, jobId, structure);
  mkdirSync(jobDirectory, { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TenderAssist';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Approved Tenders', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Tender ID', key: 'tenderId', width: 20 },
    { header: 'Reference', key: 'reference', width: 22 },
    { header: 'Full title', key: 'title', width: 52 },
    { header: 'Decision', key: 'decision', width: 15 },
    { header: 'Decision source', key: 'decisionSource', width: 17 },
    { header: 'Review reason', key: 'reviewReason', width: 30 },
    { header: 'Category', key: 'category', width: 28 },
    { header: 'Organisation', key: 'organisation', width: 35 },
    { header: 'Department', key: 'department', width: 32 },
    { header: 'State', key: 'state', width: 20 },
    { header: 'Published date', key: 'published', width: 16 },
    { header: 'Closing date', key: 'closing', width: 16 },
    { header: 'Estimated value', key: 'value', width: 18 },
    { header: 'Scope', key: 'scope', width: 45 },
    { header: 'Eligibility', key: 'eligibility', width: 45 },
    { header: 'EMD', key: 'emd', width: 20 },
    { header: 'Tender fee', key: 'fee', width: 20 },
    { header: 'Submission deadline', key: 'deadline', width: 24 },
    { header: 'Submission method', key: 'submission', width: 40 },
    { header: 'Contact', key: 'contact', width: 32 },
    { header: 'Extraction confidence', key: 'confidence', width: 21 },
    { header: 'Documents downloaded', key: 'documents', width: 22 },
    { header: 'Tender folder', key: 'folder', width: 55 },
  ];

  for (const [index, item] of items.entries()) {
    const serialNumber = item.serialNumber ?? index + 1;
    const req = requirementData(item.requirements);
    const decision = item.manualReview?.decision ?? item.automaticDecision;
    sheet.addRow({
      tenderId: item.tender.tender_portal_id ?? item.tender.tender_ref,
      reference: item.tender.tender_ref,
      title: item.tender.title,
      decision,
      decisionSource: item.manualReview ? 'Manual review' : 'Automation',
      reviewReason: item.manualReview?.reason ?? '',
      category: item.tender.detail_product_category ?? item.tender.product_category,
      organisation: item.tender.organisation_chain ?? '',
      department: item.tender.department ?? '',
      state: item.tender.state_name ?? '',
      published: item.tender.published_date ?? '',
      closing: item.tender.closing_date ?? '',
      value: item.tender.value_in_rupees === 'NA' ? '' : item.tender.value_in_rupees,
      scope: req.scope ?? '', eligibility: req.eligibility ?? '', emd: req.emd ?? '',
      fee: req.tenderFee ?? '', deadline: req.submissionDeadline ?? '',
      submission: req.submissionMethod ?? '', contact: req.contact ?? '',
      confidence: item.requirements?.confidence ?? '',
      documents: item.documents.filter((document) => document.state === 'DOWNLOADED').length,
      folder: tenderOutputDirectory(jobDirectory, item.tender, serialNumber, structure, searchDate),
    });
    await publishTenderEligibilityWorkbook(
      tenderOutputDirectory(jobDirectory, item.tender, serialNumber, structure, searchDate),
      item,
      serialNumber,
      structure,
      searchDate
    );
  }

  sheet.autoFilter = { from: 'A1', to: 'W1' };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF263B93' } };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  for (const row of sheet.getRows(2, Math.max(items.length, 1)) ?? []) {
    row.alignment = { vertical: 'top', wrapText: true };
  }
  const workbookPath = join(jobDirectory, approvedWorkbookName(resolveOutputStructure(structure, searchDate).approvedWorkbook, runNumber));
  await workbook.xlsx.writeFile(workbookPath);
  return { jobDirectory, workbookPath };
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
