// The day's report sheet, in the office's own columns (as in its
// "Tenders Interested" workbook): one row per kept tender.

import type { TenderRow } from '../persistence/repositories/tenderRepository.js';

export interface ReportColumn {
  header: string;
  key: keyof ReportRow;
  width: number;
}

export interface ReportLink {
  text: string;
  /** A web address, or a path relative to the report sheet's folder. */
  target: string;
}

export interface ReportRow {
  serialNumber: number;
  tdrNumber: string;
  department: string;
  location: string;
  shortTitle: string;
  projectNature: string;
  tenderValue: string;
  bidStartDate: string;
  bidEndDate: string;
  emd: string;
  preBidMeetingDate: string;
  eligibility: string;
  eligibilityNotes: string;
  viewTenderLink: ReportLink | null;
  tenderDocumentLink: ReportLink | null;
}

export const REPORT_COLUMNS: readonly ReportColumn[] = [
  { header: 'SI No', key: 'serialNumber', width: 7 },
  { header: 'TDR Number', key: 'tdrNumber', width: 24 },
  { header: 'Department', key: 'department', width: 34 },
  { header: 'Location', key: 'location', width: 28 },
  { header: 'Tender Title (short)', key: 'shortTitle', width: 48 },
  { header: 'Project Nature', key: 'projectNature', width: 18 },
  { header: 'Tender Value', key: 'tenderValue', width: 16 },
  { header: 'Bid Start Date', key: 'bidStartDate', width: 20 },
  { header: 'Bid End Date', key: 'bidEndDate', width: 20 },
  { header: 'EMD', key: 'emd', width: 14 },
  { header: 'Pre-bid Meeting Date', key: 'preBidMeetingDate', width: 20 },
  { header: 'Eligibility', key: 'eligibility', width: 14 },
  { header: 'Eligibility Notes', key: 'eligibilityNotes', width: 48 },
  { header: 'View Tender Link', key: 'viewTenderLink', width: 22 },
  { header: 'Tender Document Link', key: 'tenderDocumentLink', width: 22 },
];

/** The "Label: value" lines at the top of a tender's saved details, by label. */
export function detailFieldMap(detailText: string | null | undefined): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of (detailText ?? '').split('\n')) {
    if (!line.trim()) break;
    const match = /^([^:\n]{2,80}):\s+(.+)$/.exec(line.trim());
    if (match && !fields.has(match[1].trim().toLowerCase())) fields.set(match[1].trim().toLowerCase(), match[2].trim());
  }
  return fields;
}

const EMPTY = /^(?:na|n\/a|nil|-+|0\.00|null)$/i;

function field(fields: Map<string, string>, ...labels: RegExp[]): string {
  for (const label of labels) {
    for (const [key, value] of fields) if (label.test(key) && !EMPTY.test(value)) return value;
  }
  return '';
}

/** "Custom Bid for Services - Development of …" → "Development of …", at most 90 characters. */
export function shortTitle(title: string): string {
  const clean = title.replace(/^custom bid for services\s*-\s*/i, '').split(/,Custom Bid for Services - /i)[0].replace(/\s+/g, ' ').trim();
  return clean.length > 90 ? `${clean.slice(0, 87).trimEnd()}…` : clean;
}

const NATURES: Array<{ nature: string; pattern: RegExp }> = [
  { nature: 'E-learning', pattern: /\be-?learning\b|\blms\b|learning management|e-?content|\bigot\b|content development|courseware|edtech/i },
  { nature: 'Website / Mobile App', pattern: /(?=.*\b(?:websites?|web ?portal)\b)(?=.*\bmobile app(?:lication)?s?\b)/i },
  { nature: 'Mobile App', pattern: /\bmobile app(?:lication)?s?\b|\bandroid\b|\bios\b/i },
  { nature: 'Website', pattern: /\bwebsites?\b|\bweb ?portal\b|\bportal\b|\bweb hosting\b/i },
  { nature: 'Empanelment', pattern: /\bempanel/i },
  { nature: 'Application Dev', pattern: /application dev|app dev|\bit projects?\b|software development|web application|web based|application modules|digital application|online application|registration system|online recruitment|developing and hosting/i },
  { nature: 'Software', pattern: /\bsoftware\b|\berp\b|\bsaas\b|management system|information system|\bhrms\b|chatbot|\bcms\b|automation/i },
];

/** The kind of work, in the office's own words. */
export function projectNature(text: string): string {
  return NATURES.find(({ pattern }) => pattern.test(text))?.nature ?? 'Other';
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** Any date the websites give, as DD-MM-YYYY with the time when there is one. */
export function reportDate(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  let match = /^(\d{2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}:\d{2}\s*[AP]M))?/.exec(value);
  if (match && MONTHS[match[2].toLowerCase()]) return `${match[1]}-${MONTHS[match[2].toLowerCase()]}-${match[3]}${match[4] ? ` ${match[4]}` : ''}`;
  match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (match) {
    if (!match[4]) return `${match[3]}-${match[2]}-${match[1]}`;
    const hour = Number(match[4]);
    return `${match[3]}-${match[2]}-${match[1]} ${String(hour % 12 === 0 ? 12 : hour % 12).padStart(2, '0')}:${match[5]} ${hour < 12 ? 'AM' : 'PM'}`;
  }
  match = /^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(value);
  if (match) {
    if (!match[4]) return `${match[1]}-${match[2]}-${match[3]}`;
    const hour = Number(match[4]);
    return `${match[1]}-${match[2]}-${match[3]} ${String(hour % 12 === 0 ? 12 : hour % 12).padStart(2, '0')}:${match[5]} ${hour < 12 ? 'AM' : 'PM'}`;
  }
  return value;
}

export interface ReportRowInput {
  tender: TenderRow;
  serialNumber: number;
  /** The scope or eligibility the requirement reader found, for notes. */
  eligibility?: string | null;
  emd?: string | null;
  /** The website's address, for tenders with no page of their own to link to. */
  portalUrl?: string;
  portalName?: string;
  /** The tender's Documents folder, relative to the report sheet. */
  documentsFolder?: string;
}

export function reportRow(input: ReportRowInput): ReportRow {
  const { tender } = input;
  const fields = detailFieldMap(tender.detail_text);
  const gem = /^GEM\//i.test(tender.tender_ref);
  const organisation = (tender.organisation_chain ?? '').split('||').map((part) => part.trim()).filter(Boolean);
  const location = [field(fields, /^location$/), field(fields, /^pincode$/)].filter(Boolean).join(' - ') || tender.state_name || '';
  const title = field(fields, /^work description$/) || tender.title;
  const bidId = tender.tender_portal_id ?? '';
  return {
    serialNumber: input.serialNumber,
    tdrNumber: gem ? tender.tender_ref : field(fields, /^tender id$/) || bidId || tender.tender_ref,
    department: tender.department || organisation[1] || organisation[0] || '',
    location,
    shortTitle: shortTitle(tender.title),
    projectNature: projectNature(`${tender.title} ${title} ${tender.detail_product_category ?? tender.product_category ?? ''}`),
    tenderValue: field(fields, /^tender value/) || (tender.value_in_rupees && !EMPTY.test(tender.value_in_rupees) ? tender.value_in_rupees : ''),
    bidStartDate: reportDate(field(fields, /^bid submission start date$/, /^bid start date$/) || tender.published_date),
    bidEndDate: reportDate(field(fields, /^bid submission end date$/) || tender.closing_date),
    emd: field(fields, /^emd amount/) || input.emd || '',
    preBidMeetingDate: reportDate(field(fields, /^pre bid meeting date$/)),
    // Whether the company qualifies is the operator's call; the notes give what the tender asks for.
    eligibility: 'To check',
    eligibilityNotes: field(fields, /^pre-?\s*qualification/) || input.eligibility || '',
    viewTenderLink: gem && bidId
      ? { text: 'Open on GeM', target: `https://bidplus.gem.gov.in/showbidDocument/${bidId}` }
      : input.portalUrl ? { text: `Open ${input.portalName ?? 'the website'} (Tender ID ${bidId || tender.tender_ref})`, target: input.portalUrl } : null,
    tenderDocumentLink: input.documentsFolder ? { text: 'Open documents', target: input.documentsFolder } : null,
  };
}
