import type { DatabaseSync } from 'node:sqlite';
import { EMPTY_COMPANY_PROFILE, type CompanyProfile, type CompanyProject, type LegalForm } from '../../review/qualifyCheck.js';

const SETTINGS_KEY = 'company_profile';
const LEGAL_FORMS: readonly LegalForm[] = ['', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'LLP', 'PARTNERSHIP', 'PROPRIETORSHIP', 'SOCIETY'];

function numberOrNull(value: unknown, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Numbers in your company facts must be 0 or more.');
  return Math.min(number, max);
}

/** The company's facts as the operator typed them, checked and tidied. */
export function normalizeCompanyProfile(input: unknown): CompanyProfile {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const legalForm = LEGAL_FORMS.includes(source.legalForm as LegalForm) ? source.legalForm as LegalForm : '';
  const projects = (Array.isArray(source.projects) ? source.projects : []).slice(0, 50)
    .map((project): CompanyProject => {
      const entry = (typeof project === 'object' && project !== null ? project : {}) as Record<string, unknown>;
      const year = numberOrNull(entry.year, 2100);
      return { name: text(entry.name, 120), valueLakh: numberOrNull(entry.valueLakh, 1_000_000), year: year === null ? null : Math.round(year) };
    })
    .filter((project) => project.name || project.valueLakh !== null);
  return {
    companyName: text(source.companyName),
    legalForm,
    yearsInBusiness: numberOrNull(source.yearsInBusiness, 200),
    averageTurnoverLakh: numberOrNull(source.averageTurnoverLakh, 10_000_000),
    positiveNetWorth: typeof source.positiveNetWorth === 'boolean' ? source.positiveNetWorth : null,
    mse: source.mse === true,
    startup: source.startup === true,
    technicalStaff: numberOrNull(source.technicalStaff, 1_000_000),
    certifications: [...new Set((Array.isArray(source.certifications) ? source.certifications : []).map((value) => text(value, 60)).filter(Boolean))].slice(0, 30),
    projects,
    blacklisted: source.blacklisted === true,
  };
}

/** The company's own facts, for "Do we qualify?" (Settings → Your company). */
export class CompanyProfileRepository {
  constructor(private db: DatabaseSync) {}

  get(): CompanyProfile {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(SETTINGS_KEY) as { value_json: string } | undefined;
    if (!row) return { ...EMPTY_COMPANY_PROFILE };
    try { return normalizeCompanyProfile(JSON.parse(row.value_json)); } catch { return { ...EMPTY_COMPANY_PROFILE }; }
  }

  save(input: unknown): CompanyProfile {
    const profile = normalizeCompanyProfile(input);
    this.db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(SETTINGS_KEY, JSON.stringify(profile), new Date().toISOString());
    return profile;
  }
}
