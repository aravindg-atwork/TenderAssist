import ExcelJS from 'exceljs';
import { cpSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { FinalClassification } from '../persistence/repositories/classificationRepository.js';
import type { TenderDocumentRow, TenderRequirementRow, TenderReviewRow } from '../persistence/repositories/tenderWorkflowRepository.js';

export interface PublishableTender {
  tender: TenderRow;
  automaticDecision: FinalClassification;
  manualReview?: TenderReviewRow;
  documents: TenderDocumentRow[];
  requirements?: TenderRequirementRow;
}

function safeSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'untitled';
}

function requirementData(row?: TenderRequirementRow): Record<string, string | null> {
  if (!row) return {};
  try { return JSON.parse(row.data_json) as Record<string, string | null>; }
  catch { return {}; }
}

export function jobOutputDirectory(outputRoot: string, searchDate: string, jobId: string): string {
  return join(outputRoot, `${searchDate}_${jobId.slice(0, 8)}`);
}

export function tenderOutputDirectory(jobDirectory: string, tender: TenderRow): string {
  return join(jobDirectory, safeSegment(`${tender.tender_portal_id ?? tender.tender_ref} ${tender.title}`));
}

export async function publishJobWorkbook(
  outputRoot: string,
  searchDate: string,
  jobId: string,
  items: PublishableTender[]
): Promise<{ jobDirectory: string; workbookPath: string }> {
  const jobDirectory = jobOutputDirectory(outputRoot, searchDate, jobId);
  mkdirSync(jobDirectory, { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TenderAssist';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Tenders', { views: [{ state: 'frozen', ySplit: 1 }] });
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

  for (const item of items) {
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
      folder: tenderOutputDirectory(jobDirectory, item.tender),
    });
  }

  sheet.autoFilter = { from: 'A1', to: 'W1' };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF263B93' } };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  for (const row of sheet.getRows(2, Math.max(items.length, 1)) ?? []) {
    row.alignment = { vertical: 'top', wrapText: true };
  }
  const workbookPath = join(jobDirectory, `TenderAssist-${searchDate}.xlsx`);
  await workbook.xlsx.writeFile(workbookPath);
  return { jobDirectory, workbookPath };
}

export function mirrorJobOutputToDrive(
  localJobDirectory: string,
  driveOutputRoot: string,
  searchDate: string,
  jobId: string
): string | null {
  const driveRoot = driveOutputRoot.trim();
  if (!driveRoot) return null;
  const destination = jobOutputDirectory(driveRoot, searchDate, jobId);
  if (resolve(destination).toLocaleLowerCase() === resolve(localJobDirectory).toLocaleLowerCase()) return destination;
  mkdirSync(driveRoot, { recursive: true });
  cpSync(localJobDirectory, destination, { recursive: true, force: true });
  return destination;
}
