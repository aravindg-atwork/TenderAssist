export interface OutputStructureSettings {
  monthFolderTemplate: string;
  dayFolderTemplate: string;
  tenderFolderTemplate: string;
  approvedWorkbookTemplate: string;
  eligibilityWorkbookTemplate: string;
  documentsFolderTemplate: string;
}

export interface ResolvedOutputStructure {
  monthFolder: string;
  dayFolder: string;
  tenderFolder: string;
  approvedWorkbook: string;
  eligibilityWorkbook: string;
  documentsFolder: string;
}

export const DEFAULT_OUTPUT_STRUCTURE: OutputStructureSettings = {
  monthFolderTemplate: '{MONTH}-{YYYY}',
  dayFolderTemplate: '{DD}-{MM}-{YYYY}',
  tenderFolderTemplate: '{DD}-{MM}-{YYYY}_{SNO}_{TITLE}',
  approvedWorkbookTemplate: 'Approved-Tenders-{DD}-{MM}-{YYYY}.xlsx',
  eligibilityWorkbookTemplate: 'Eligibility.xlsx',
  documentsFolderTemplate: 'Documents',
};

const ALLOWED_TOKENS = new Set(['DD', 'MM', 'MONTH', 'YYYY', 'SNO', 'TITLE']);

/** The month folder template before October 2026, when months were numbers (10-2026). */
export const PREVIOUS_MONTH_FOLDER_TEMPLATE = '{MM}-{YYYY}';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const INVALID_SEGMENT_CHARACTERS = /[<>:"/\\|?*\x00-\x1F]/;

function dateParts(value: string): Record<'DD' | 'MM' | 'MONTH' | 'YYYY', string> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Output date must use YYYY-MM-DD format.');
  return { YYYY: match[1], MM: match[2], MONTH: MONTH_NAMES[Number(match[2]) - 1] ?? match[2], DD: match[3] };
}

function validateTemplate(label: string, value: unknown): string {
  const template = typeof value === 'string' ? value.trim() : '';
  if (!template) throw new Error(`${label} cannot be empty.`);
  if (template === '.' || template === '..') throw new Error(`${label} cannot be a relative path.`);
  if (INVALID_SEGMENT_CHARACTERS.test(template)) throw new Error(`${label} contains a character Windows cannot use in a file name.`);
  const tokens = template.match(/\{[^}]*\}/g) ?? [];
  for (const token of tokens) {
    const name = token.slice(1, -1);
    if (!ALLOWED_TOKENS.has(name)) throw new Error(`${label} uses unsupported token ${token}.`);
  }
  if (/[{}]/.test(template.replace(/\{(?:DD|MM|MONTH|YYYY|SNO|TITLE)\}/g, ''))) {
    throw new Error(`${label} has an incomplete token.`);
  }
  return template;
}

function ensureWorkbookExtension(template: string): string {
  return template.toLocaleLowerCase().endsWith('.xlsx') ? template : `${template}.xlsx`;
}

export function normalizeOutputStructure(input?: Partial<OutputStructureSettings> | null): OutputStructureSettings {
  const source = input ?? DEFAULT_OUTPUT_STRUCTURE;
  const tenderFolderTemplate = validateTemplate('Tender folder template', source.tenderFolderTemplate ?? DEFAULT_OUTPUT_STRUCTURE.tenderFolderTemplate);
  if (!tenderFolderTemplate.includes('{SNO}')) {
    throw new Error('Tender folder template must include {SNO} so approved tenders cannot overwrite one another.');
  }
  return {
    monthFolderTemplate: validateTemplate('Month folder template', source.monthFolderTemplate ?? DEFAULT_OUTPUT_STRUCTURE.monthFolderTemplate),
    dayFolderTemplate: validateTemplate('Day folder template', source.dayFolderTemplate ?? DEFAULT_OUTPUT_STRUCTURE.dayFolderTemplate),
    tenderFolderTemplate,
    approvedWorkbookTemplate: ensureWorkbookExtension(validateTemplate('Approved workbook template', source.approvedWorkbookTemplate ?? DEFAULT_OUTPUT_STRUCTURE.approvedWorkbookTemplate)),
    eligibilityWorkbookTemplate: ensureWorkbookExtension(validateTemplate('Eligibility workbook template', source.eligibilityWorkbookTemplate ?? DEFAULT_OUTPUT_STRUCTURE.eligibilityWorkbookTemplate)),
    documentsFolderTemplate: validateTemplate('Documents folder template', source.documentsFolderTemplate ?? DEFAULT_OUTPUT_STRUCTURE.documentsFolderTemplate),
  };
}

function safeSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 160) || 'untitled';
}

export function resolveOutputStructure(
  structure: OutputStructureSettings,
  outputDate: string,
  title = 'Tender title',
  serialNumber = 1
): ResolvedOutputStructure {
  const normalized = normalizeOutputStructure(structure);
  const tokens = { ...dateParts(outputDate), SNO: String(serialNumber), TITLE: title };
  const render = (template: string) => safeSegment(template.replace(/\{(DD|MM|MONTH|YYYY|SNO|TITLE)\}/g, (_match, token: keyof typeof tokens) => tokens[token]));
  const renderWorkbook = (template: string) => ensureWorkbookExtension(render(template));
  return {
    monthFolder: render(normalized.monthFolderTemplate),
    dayFolder: render(normalized.dayFolderTemplate),
    tenderFolder: render(normalized.tenderFolderTemplate),
    approvedWorkbook: renderWorkbook(normalized.approvedWorkbookTemplate),
    eligibilityWorkbook: renderWorkbook(normalized.eligibilityWorkbookTemplate),
    documentsFolder: render(normalized.documentsFolderTemplate),
  };
}
