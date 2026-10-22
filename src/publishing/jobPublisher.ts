import ExcelJS from 'exceljs';
import { coverDocuments, tenderPageFields } from '../review/portalPage.js';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { FinalClassification } from '../persistence/repositories/classificationRepository.js';
import type { TenderDocumentRow, TenderRequirementRow, TenderReviewRow } from '../persistence/repositories/tenderWorkflowRepository.js';
import { DEFAULT_OUTPUT_STRUCTURE, resolveOutputStructure, type OutputStructureSettings } from './outputStructure.js';
import { REPORT_COLUMNS, reportDate, reportRow } from './reportSheet.js';
import { QUALIFICATION_KIND_LABELS, type QualificationSection } from '../extraction/qualificationSections.js';
import type { QualifyReport } from '../review/qualifyCheck.js';

export interface PublishableTender {
  tender: TenderRow;
  automaticDecision: FinalClassification;
  manualReview?: TenderReviewRow;
  documents: TenderDocumentRow[];
  requirements?: TenderRequirementRow;
  /** Stable S.No within the day folder; defaults to the item's position. */
  serialNumber?: number;
  /** The website this tender came from, when one sheet holds several websites. */
  portal?: { url: string; name: string };
  /** "Do we qualify?": its criteria checked against the company's facts, when they are filled in. */
  qualification?: QualifyReport;
}

/**
 * How a day's report sheets are split. PER_WEBSITE (the default): one sheet
 * per website per day, every run of that website that day in it.
 * ONE_PER_DAY: every website's tenders of the day in a single sheet.
 */
export type ReportSheetMode = 'PER_WEBSITE' | 'ONE_PER_DAY';

/** The file name of a day sheet: "Approved-Tenders-12-10-2026 - GeM.xlsx", or the plain name for one sheet per day. */
export function daySheetFileName(fileName: string, mode: ReportSheetMode, portalName: string): string {
  if (mode === 'ONE_PER_DAY') return fileName;
  // The short form of the website's name: "GeM (Government e-Marketplace)" → "GeM", "Bharat Electronics Limited (BEL)" → "BEL".
  const bracketed = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(portalName.trim());
  const short = bracketed ? [bracketed[1], bracketed[2]].sort((a, b) => a.length - b.length)[0] : portalName;
  const website = short.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim() || 'Website';
  return fileName.replace(/\.xlsx$/i, ` - ${website}.xlsx`);
}

/** Whether a file is one of the day's report sheets, under any name TenderAssist gave it (website, "(run N)", or plain). */
export function isDaySheet(fileName: string, name: string): boolean {
  const stem = fileName.replace(/\.xlsx$/i, '').toLocaleLowerCase();
  return /\.xlsx$/i.test(name) && name.toLocaleLowerCase().startsWith(stem) && !name.startsWith('~$');
}

/**
 * Of a day folder's files, the report sheet that goes to one website's Drive
 * folder: its own sheet ("… - GeM.xlsx"), or with one sheet for the day, that
 * sheet (it lists every website, so each website's folder gets it).
 */
export function daySheetsOfWebsite(names: string[], fileName: string, mode: ReportSheetMode, portalName: string): string[] {
  const own = daySheetFileName(fileName, mode, portalName).toLocaleLowerCase();
  return names.filter((name) => isDaySheet(fileName, name) && name.toLocaleLowerCase() === own);
}

function requirementData(row?: TenderRequirementRow): Record<string, string | null> {
  if (!row) return {};
  try { return JSON.parse(row.data_json) as Record<string, string | null>; }
  catch { return {}; }
}

/** The qualification sections the requirement reader found, if any. */
function requirementSections(row?: TenderRequirementRow): QualificationSection[] {
  if (!row) return [];
  try {
    const sections = (JSON.parse(row.data_json) as { sections?: unknown }).sections;
    return Array.isArray(sections) ? sections as QualificationSection[] : [];
  } catch { return []; }
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

/** The "Label: value" lines TenderAssist saved from the website or the GeM bid PDF, in their order and wording. */
function websiteFields(detailText: string | null | undefined): Array<[string, string]> {
  return tenderPageFields(detailText).map((field) => [field.label, field.value]);
}

const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF263B93' } } as const;
const GROUP_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F5' } } as const;

/**
 * One tender's eligibility workbook. "Eligibility" holds the facts a bidder
 * checks first, then every detail the website or bid PDF gave, so nothing
 * read is lost. "Qualifications" lists, point by point, the criteria found in
 * the documents (pre-qualification, the buyer's terms, technical evaluation,
 * documents to submit), each with the file and page it came from.
 */
async function publishTenderEligibilityWorkbook(
  tenderDirectory: string,
  item: PublishableTender,
  serialNumber: number,
  structure: OutputStructureSettings,
  outputDate: string
): Promise<void> {
  mkdirSync(tenderDirectory, { recursive: true });
  const req = requirementData(item.requirements);
  const text = (key: string) => (typeof req[key] === 'string' ? req[key]! : '');
  const sections = requirementSections(item.requirements);
  const decision = item.manualReview?.decision ?? item.automaticDecision;
  const row = reportRow({ tender: item.tender, serialNumber, eligibility: text('eligibility'), emd: text('emd') });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TenderAssist';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Eligibility', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Field', key: 'field', width: 30 },
    { header: 'Value', key: 'value', width: 100 },
  ];
  const group = (title: string) => {
    const added = sheet.addRow({ field: title, value: '' });
    added.font = { bold: true };
    added.eachCell({ includeEmpty: true }, (cell) => { cell.fill = GROUP_FILL; });
  };
  const add = (rows: Array<[string, string | number | null | undefined]>) => {
    for (const [field, value] of rows) if (value !== null && value !== undefined && value !== '') sheet.addRow({ field, value });
  };
  group('The tender');
  add([
    ['S.No', serialNumber],
    ['Tender ID', item.tender.tender_portal_id ?? item.tender.tender_ref],
    ['Reference', item.tender.tender_ref],
    ['Tender title', item.tender.title],
    ['Department', row.department],
    ['Organisation', (item.tender.organisation_chain ?? '').replace(/\|\|/g, ' › ')],
    ['Location', row.location],
    ['State', item.tender.state_name],
    ['Category', item.tender.detail_product_category ?? item.tender.product_category],
    ['Published / bid start', row.bidStartDate],
    ['Closing / bid end', row.bidEndDate],
    ['Pre-bid meeting', row.preBidMeetingDate],
    ['Tender value', row.tenderValue],
    ['EMD', row.emd],
    ['Tender fee', text('tenderFee')],
    ['Submission method', text('submissionMethod')],
    ['How bids are evaluated', text('evaluation')],
    ['Contact', text('contact')],
  ]);
  group('What the bidder must meet');
  const pointCount = sections.reduce((count, section) => count + Math.max(1, section.items.length), 0);
  const qualify = item.qualification?.profileFilled && item.qualification.checks.length > 0 ? item.qualification : undefined;
  add([
    ['Do we qualify?', qualify
      ? `${qualify.notMet > 0 ? `Does not meet ${qualify.notMet}` : 'Meets all it could check'}: ${qualify.met} met, ${qualify.notMet} not met, ${qualify.toCheck} to check (see the Do we qualify sheet)`
      : ''],
    ['Eligibility (summary)', row.eligibilityNotes || 'Not found in the documents: read the tender documents'],
    ['Scope', text('scope')],
    ['Qualification points found', sections.length > 0
      ? `${pointCount}, listed on the Qualifications sheet`
      : 'None found: the documents may be scanned images, or name them differently'],
  ]);
  const covers = coverDocuments(item.tender.detail_text);
  if (covers.length > 0) {
    group('Documents to upload (the website’s cover list)');
    add(covers.flatMap((cover, index) => cover.documents.map((document, at): [string, string] => [
      at === 0 ? `Cover ${index + 1}: ${cover.cover}` : '', `${document.description} (${document.type})`,
    ])));
  }
  group('Your decision');
  add([
    ['Approved decision', decision],
    ['Approval source', item.manualReview ? 'Manual review' : 'Automation'],
    ['Review reason', item.manualReview?.reason],
    ['Documents downloaded', item.documents.filter((document) => document.state === 'DOWNLOADED').length],
    ['Extraction confidence', item.requirements?.confidence],
  ]);
  const shown = new Set(['bid number', 'work description']);
  const details = websiteFields(item.tender.detail_text).filter(([label]) => !shown.has(label.toLowerCase()));
  if (details.length > 0) {
    group('Everything the website or bid PDF gave');
    add(details);
  }
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = HEADER_FONT;
  sheet.getRow(1).fill = HEADER_FILL;
  sheet.getColumn(1).alignment = { vertical: 'top' };
  sheet.getColumn(2).alignment = { vertical: 'top', wrapText: true };

  const points = workbook.addWorksheet('Qualifications', { views: [{ state: 'frozen', ySplit: 1 }] });
  points.columns = [
    { header: 'Section', key: 'kind', width: 26 },
    { header: '#', key: 'point', width: 5 },
    { header: 'Requirement (as the document says)', key: 'requirement', width: 100 },
    { header: 'Meets it? (fill in)', key: 'meets', width: 16 },
    { header: 'From', key: 'source', width: 40 },
  ];
  if (sections.length === 0) {
    points.addRow({ kind: 'None found', requirement: 'No eligibility or qualification section was found in the downloaded documents. Scanned documents are read with OCR when Windows has it; check the documents themselves.' });
  }
  for (const section of sections) {
    const source = `${section.document}${section.page ? `, page ${section.page}` : ''} (“${section.heading}”)`;
    const kind = QUALIFICATION_KIND_LABELS[section.kind] ?? section.kind;
    const entries = section.items.length > 0 ? section.items : [section.text];
    for (const entry of entries) {
      // The point's own number ("B. Bidder Experience" groups have none); Excel holds at most 32,767 characters in a cell.
      const number = section.items.length > 0 ? /^(\d{1,2})[.)]?\s/.exec(entry)?.[1] : undefined;
      points.addRow({ kind, point: number ? Number(number) : '', requirement: entry.length > 32_000 ? `${entry.slice(0, 31_990)}…` : entry, source });
    }
  }
  points.getRow(1).height = 28;
  points.getRow(1).font = HEADER_FONT;
  points.getRow(1).fill = HEADER_FILL;
  for (const key of ['kind', 'requirement', 'source']) points.getColumn(key).alignment = { vertical: 'top', wrapText: true };
  points.autoFilter = { from: 'A1', to: 'E1' };

  if (qualify) {
    const checks = workbook.addWorksheet('Do we qualify', { views: [{ state: 'frozen', ySplit: 1 }] });
    checks.columns = [
      { header: 'Result', key: 'status', width: 12 },
      { header: 'Why', key: 'reason', width: 60 },
      { header: 'Criterion', key: 'requirement', width: 80 },
      { header: 'From', key: 'source', width: 36 },
    ];
    const label = { MET: 'Met', NOT_MET: 'Not met', CHECK: 'Check' } as const;
    const fill = { MET: 'FFDDF4E9', NOT_MET: 'FFFDE8E6', CHECK: 'FFFFF3D4' } as const;
    for (const check of [...qualify.checks].sort((a, b) => ['NOT_MET', 'CHECK', 'MET'].indexOf(a.status) - ['NOT_MET', 'CHECK', 'MET'].indexOf(b.status))) {
      const added = checks.addRow({ status: label[check.status], reason: check.reason, requirement: check.requirement, source: check.source });
      added.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill[check.status] } };
    }
    checks.getRow(1).height = 28;
    checks.getRow(1).font = HEADER_FONT;
    checks.getRow(1).fill = HEADER_FILL;
    for (const key of ['reason', 'requirement', 'source']) checks.getColumn(key).alignment = { vertical: 'top', wrapText: true };
  }

  const fileName = resolveOutputStructure(structure, outputDate, folderTitle(item.tender.title), serialNumber).eligibilityWorkbook;
  await workbook.xlsx.writeFile(join(tenderDirectory, fileName));
}

/** Later jobs sharing a day folder get their own workbook instead of replacing the first. */
export function approvedWorkbookName(fileName: string, runNumber: number): string {
  return runNumber > 1 ? fileName.replace(/\.xlsx$/i, ` (run ${runNumber}).xlsx`) : fileName;
}

/**
 * The earlier sheet's columns, after the office's own. Columns the office's
 * set already covers are left out: Tender ID (TDR Number), Department,
 * Estimated value (Tender Value), EMD, Eligibility (Eligibility Notes), and
 * Closing date / Submission deadline (Bid End Date).
 */
const EARLIER_COLUMNS = [
  { header: 'Website', key: 'website', width: 18 },
  { header: 'Reference', key: 'reference', width: 22 },
  { header: 'Full title', key: 'title', width: 52 },
  { header: 'Decision', key: 'decision', width: 15 },
  { header: 'Decision source', key: 'decisionSource', width: 17 },
  { header: 'Review reason', key: 'reviewReason', width: 30 },
  { header: 'Category', key: 'category', width: 28 },
  { header: 'Organisation', key: 'organisation', width: 35 },
  { header: 'State', key: 'state', width: 20 },
  { header: 'Published date', key: 'published', width: 18 },
  { header: 'Scope', key: 'scope', width: 45 },
  { header: 'Tender fee', key: 'fee', width: 20 },
  { header: 'Submission method', key: 'submission', width: 40 },
  { header: 'Contact', key: 'contact', width: 32 },
  { header: 'Extraction confidence', key: 'confidence', width: 21 },
  { header: 'Documents downloaded', key: 'documents', width: 22 },
  { header: 'Tender folder', key: 'folder', width: 55 },
] as const;

export async function publishJobWorkbook(
  outputRoot: string,
  searchDate: string,
  jobId: string,
  items: PublishableTender[],
  structure: OutputStructureSettings = DEFAULT_OUTPUT_STRUCTURE,
  runNumber = 1,
  /** The website, for tenders with no page of their own to link to (an item's own portal comes first). */
  portal?: { url: string; name: string },
  /** The sheet's file name; by default the day workbook, with "(run N)" for later runs. */
  workbookFileName?: string
): Promise<{ jobDirectory: string; workbookPath: string }> {
  const jobDirectory = jobOutputDirectory(outputRoot, searchDate, jobId, structure);
  mkdirSync(jobDirectory, { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TenderAssist';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Approved Tenders', { views: [{ state: 'frozen', ySplit: 1 }] });
  // The office's own columns, as in its "Tenders Interested" workbook.
  sheet.columns = [...REPORT_COLUMNS, ...EARLIER_COLUMNS].map((column) => ({ header: column.header, key: column.key, width: column.width }));

  for (const [index, item] of items.entries()) {
    const serialNumber = item.serialNumber ?? index + 1;
    const req = requirementData(item.requirements);
    const tenderDirectory = tenderOutputDirectory(jobDirectory, item.tender, serialNumber, structure, searchDate);
    const documentsDirectory = tenderDocumentsDirectory(jobDirectory, item.tender, serialNumber, structure, searchDate);
    const website = item.portal ?? portal;
    const row = reportRow({
      tender: item.tender,
      serialNumber,
      eligibility: req.eligibility,
      emd: req.emd,
      qualification: item.qualification,
      portalUrl: website?.url,
      portalName: website?.name,
      // Relative, so the link also works in the copy on Drive.
      documentsFolder: item.documents.some((document) => document.state === 'DOWNLOADED')
        ? relative(jobDirectory, documentsDirectory).split(sep).join('/')
        : undefined,
    });
    sheet.addRow({
      ...row,
      viewTenderLink: row.viewTenderLink ? { text: row.viewTenderLink.text, hyperlink: row.viewTenderLink.target } : '',
      tenderDocumentLink: row.tenderDocumentLink ? { text: row.tenderDocumentLink.text, hyperlink: row.tenderDocumentLink.target } : '',
      gemPdfLink: row.gemPdfLink ? { text: row.gemPdfLink.text, hyperlink: row.gemPdfLink.target } : '',
      originalBidLink: row.originalBidLink ? { text: row.originalBidLink.text, hyperlink: row.originalBidLink.target } : '',
      originalBidPdfLink: row.originalBidPdfLink ? { text: row.originalBidPdfLink.text, hyperlink: row.originalBidPdfLink.target } : '',
      website: website?.name ?? '',
      reference: item.tender.tender_ref,
      title: item.tender.title,
      decision: item.manualReview?.decision ?? item.automaticDecision,
      decisionSource: item.manualReview ? 'Manual review' : 'Automation',
      reviewReason: item.manualReview?.reason ?? '',
      category: item.tender.detail_product_category ?? item.tender.product_category,
      organisation: (item.tender.organisation_chain ?? '').replace(/\|\|/g, ' › '),
      state: item.tender.state_name ?? '',
      published: reportDate(item.tender.published_date),
      scope: req.scope ?? '',
      fee: req.tenderFee ?? '',
      submission: req.submissionMethod ?? '',
      contact: req.contact ?? '',
      confidence: item.requirements?.confidence ?? '',
      documents: item.documents.filter((document) => document.state === 'DOWNLOADED').length,
      folder: tenderDirectory,
    });
    await publishTenderEligibilityWorkbook(tenderDirectory, item, serialNumber, structure, searchDate);
  }

  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(REPORT_COLUMNS.length + EARLIER_COLUMNS.length).letter}1` };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF263B93' } };
  sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  for (const row of items.length > 0 ? sheet.getRows(2, items.length) ?? [] : []) {
    row.alignment = { vertical: 'top', wrapText: true };
    for (const key of ['viewTenderLink', 'tenderDocumentLink', 'gemPdfLink', 'originalBidLink', 'originalBidPdfLink'] as const) {
      const cell = row.getCell(key);
      if (cell.value) cell.font = { color: { argb: 'FF1F4E9E' }, underline: true };
    }
  }
  const workbookPath = join(jobDirectory, workbookFileName ?? approvedWorkbookName(resolveOutputStructure(structure, searchDate).approvedWorkbook, runNumber));
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
  // The day's sheets, one per website or one for the day.
  const sheets = readdirSync(localJobDirectory).filter((name) => isDaySheet(approvedWorkbookFileName, name));
  mkdirSync(destination, { recursive: true });
  // Sheets under names no longer used here (an older "(run 2)" sheet, the other split) go from the copy too.
  const kept = new Set(sheets.map((name) => name.toLocaleLowerCase()));
  for (const name of readdirSync(destination)) {
    if (isDaySheet(approvedWorkbookFileName, name) && !kept.has(name.toLocaleLowerCase())) rmSync(join(destination, name), { force: true });
  }
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
