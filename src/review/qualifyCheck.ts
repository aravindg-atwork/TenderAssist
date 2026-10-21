// "Do we qualify?": each eligibility criterion a tender states, checked
// against the company's own facts (Settings → Your company). Read by the
// criterion's words, never by AI. Anything it cannot check is left for the
// bidder ("Check"), never guessed as met.

import type { QualificationSection } from '../extraction/qualificationSections.js';

export type LegalForm = '' | 'PRIVATE_LIMITED' | 'PUBLIC_LIMITED' | 'LLP' | 'PARTNERSHIP' | 'PROPRIETORSHIP' | 'SOCIETY';

export interface CompanyProject {
  name: string;
  /** Contract value in lakh rupees. */
  valueLakh: number | null;
  /** The year it was completed (or went live). */
  year: number | null;
}

export interface CompanyProfile {
  companyName: string;
  legalForm: LegalForm;
  yearsInBusiness: number | null;
  /** Average annual turnover of the last three financial years, in lakh rupees. */
  averageTurnoverLakh: number | null;
  /** Positive net worth in each of the last three years; null when not said. */
  positiveNetWorth: boolean | null;
  mse: boolean;
  startup: boolean;
  technicalStaff: number | null;
  /** As written, e.g. "ISO 9001", "ISO 27001", "CMMI Level 3". */
  certifications: string[];
  projects: CompanyProject[];
  blacklisted: boolean;
}

export const EMPTY_COMPANY_PROFILE: CompanyProfile = {
  companyName: '', legalForm: '', yearsInBusiness: null, averageTurnoverLakh: null, positiveNetWorth: null,
  mse: false, startup: false, technicalStaff: null, certifications: [], projects: [], blacklisted: false,
};

export type CheckStatus = 'MET' | 'NOT_MET' | 'CHECK';

export interface CriterionCheck {
  /** The criterion as the tender says it, shortened. */
  requirement: string;
  status: CheckStatus;
  /** Why, in plain words: what it asks and what the company has. */
  reason: string;
  /** Where it was read. */
  source: string;
}

export interface QualifyReport {
  checks: CriterionCheck[];
  met: number;
  notMet: number;
  toCheck: number;
  /** False until the company's facts are filled in (Settings → Your company). */
  profileFilled: boolean;
}

/** The facts GeM's bid PDF gives (gemBidDocument), as TenderAssist saved them. */
export interface GemQualificationFacts {
  minimumTurnover?: string | null;
  pastExperience?: string | null;
  mseRelaxation?: string | null;
  startupRelaxation?: string | null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20,
};

function count(word: string): number | null {
  const value = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word.toLowerCase()];
  return value === undefined || !Number.isFinite(value) ? null : value;
}

/** Money as tenders write it ("INR 40 Crore", "Rs. 50 lakh", "3999 Lakh (s)", "Rs.50,00,000/-"), in lakh. */
export function amountsInLakh(text: string): number[] {
  const amounts: number[] = [];
  const pattern = /(?:(?:Rupees|Rs\.?|INR|₹)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr\.?|lakhs?|lacs?|lakh\s*\(s\))?(?![\d%])/gi;
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(Math.max(0, match.index - 6), match.index);
    const number = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(number)) continue;
    const unit = (match[2] ?? '').toLowerCase();
    const money = unit !== '' || /(?:Rupees|Rs\.?|INR|₹)\s*$/i.test(`${before}${match[0].slice(0, match[0].indexOf(match[1]))}`);
    if (!money) continue;
    if (/^cr/.test(unit)) amounts.push(number * 100);
    else if (/^la/.test(unit)) amounts.push(number);
    else if (number >= 10_000) amounts.push(number / 100_000);
  }
  return amounts;
}

function lakhText(lakh: number): string {
  return lakh >= 100 ? `₹${+(lakh / 100).toFixed(2)} Cr` : `₹${+lakh.toFixed(2)} lakh`;
}

function short(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const YEARS = /(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\s*(?:\(\s*\d{1,2}\s*\)\s*)?(?:years?|yrs?)\b/i;

/** The company's significant name words, without "M/s", "Private Limited" and the like. */
function nameWords(name: string): string[] {
  return name.toLowerCase().replace(/\bm\/s\.?/g, ' ').split(/[^a-z0-9&]+/)
    .filter((word) => word.length > 1 && !['private', 'pvt', 'limited', 'ltd', 'llp', 'the', 'and', 'india', 'co', 'company'].includes(word));
}

/** One criterion checked against the company: by what it is about, most specific first. */
export function checkCriterion(text: string, profile: CompanyProfile, source: string, now = new Date()): CriterionCheck {
  const flat = text.replace(/\s+/g, ' ');
  const result = (status: CheckStatus, reason: string): CriterionCheck => ({ requirement: short(flat), status, reason, source });
  const lower = flat.toLowerCase();

  // A list of the only firms that may bid.
  if (/\bonly\b[^.]{0,80}\beligible\b|\bfollowing\s+bidders\b|\bshortlisted\b/i.test(flat)) {
    if (!profile.companyName.trim()) return result('CHECK', 'Only named or shortlisted firms may bid. Add your company name in Settings → Your company to check.');
    const words = nameWords(profile.companyName);
    const named = words.length > 0 && words.every((word) => lower.includes(word));
    return named ? result('MET', 'Your company is among the firms named.') : result('NOT_MET', 'Only the firms named here may bid, and yours is not among them.');
  }
  if (/black\s*-?\s*list|debar/i.test(flat)) {
    return profile.blacklisted ? result('NOT_MET', 'Your company is marked as blacklisted or debarred.') : result('MET', 'Not blacklisted or debarred (as you set it).');
  }
  if (/net\s*-?\s*worth/i.test(flat) && !/turnover/i.test(flat)) {
    if (profile.positiveNetWorth === null) return result('CHECK', 'Asks for positive net worth; not filled in for your company.');
    return profile.positiveNetWorth ? result('MET', 'Positive net worth (as you set it).') : result('NOT_MET', 'Asks for positive net worth; yours is not.');
  }
  if (/turn\s*-?\s*over/i.test(flat)) {
    const amounts = amountsInLakh(flat);
    if (amounts.length === 0) return result('CHECK', 'Asks for a turnover; the amount could not be read.');
    const relaxedAt = flat.search(/relax|exempt|MSE|MSME|start\s*-?\s*up/i);
    const relaxed = relaxedAt >= 0 && (profile.mse || profile.startup) ? amountsInLakh(flat.slice(relaxedAt)) : [];
    const needed = relaxed.length > 0 ? Math.min(...relaxed) : amounts[0];
    const asWhom = relaxed.length > 0 ? ` (the ${profile.startup && !profile.mse ? 'startup' : 'MSE'} relaxation)` : '';
    if (profile.averageTurnoverLakh === null) return result('CHECK', `Asks for ${lakhText(needed)} average turnover${asWhom}; your turnover is not filled in.`);
    return profile.averageTurnoverLakh >= needed
      ? result('MET', `Asks for ${lakhText(needed)}${asWhom}; you have ${lakhText(profile.averageTurnoverLakh)}.`)
      : result('NOT_MET', `Asks for ${lakhText(needed)}${asWhom}; you have ${lakhText(profile.averageTurnoverLakh)}.`);
  }
  const projects = /(?:at\s+least|minimum(?:\s+of)?|not\s+less\s+than)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\(\s*\d{1,2}\s*\)\s*)?(?:[a-z/&-]+\s+){0,8}?(?:projects?|works?|orders?|assignments?|portals?|applications?|contracts?)\b/i.exec(flat);
  if (projects) {
    const wanted = count(projects[1]) ?? 1;
    const value = /(?:value|worth|cost)[^.]{0,40}?(?:not\s+less\s+than|minimum|at\s+least|of|above|exceeding)?[^.]{0,10}?((?:Rupees|Rs\.?|INR|₹)\s*[\d,.]+\s*(?:crores?|cr|lakhs?|lacs?)?|[\d,.]+\s*(?:crores?|cr|lakhs?|lacs?))/i.exec(flat);
    const minLakh = value ? amountsInLakh(value[1])[0] ?? null : null;
    const window = /(?:last|past|preceding)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\(\s*\d{1,2}\s*\)\s*)?(?:financial\s+)?years?/i.exec(flat);
    const sinceYear = window ? now.getFullYear() - (count(window[1]) ?? 0) : null;
    const asked = `${wanted} similar ${wanted === 1 ? 'project' : 'projects'}${minLakh ? ` of ${lakhText(minLakh)} or more each` : ''}${sinceYear ? ` since ${sinceYear}` : ''}`;
    if (profile.projects.length === 0) return result('CHECK', `Asks for ${asked}; no projects are listed for your company.`);
    const fitting = profile.projects.filter((project) => (minLakh === null || (project.valueLakh ?? 0) >= minLakh)
      && (sinceYear === null || (project.year ?? 0) >= sinceYear));
    return fitting.length >= wanted
      ? result('MET', `Asks for ${asked}; you have ${fitting.length} (${fitting.slice(0, 3).map((project) => project.name).join(', ')}). Check they are similar work.`)
      : result('NOT_MET', `Asks for ${asked}; you have ${fitting.length} that fit.`);
  }
  const staff = /(?:minimum(?:\s+of)?|at\s+least|not\s+less\s+than)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\s*(?:\(\s*\w+\s*\)\s*)?(?:[a-z/&-]+\s+){0,4}?(?:personnel|staff|employees|manpower|professionals|engineers|developers|resources)\b/i.exec(flat);
  if (staff) {
    const wanted = count(staff[1]);
    if (wanted === null) return result('CHECK', 'Asks for a number of staff; the number could not be read.');
    if (profile.technicalStaff === null) return result('CHECK', `Asks for ${wanted} staff; your staff count is not filled in.`);
    return profile.technicalStaff >= wanted
      ? result('MET', `Asks for ${wanted} staff; you have ${profile.technicalStaff}.`)
      : result('NOT_MET', `Asks for ${wanted} staff; you have ${profile.technicalStaff}.`);
  }
  const certificates = [...flat.matchAll(/\bISO\s*[:/-]?\s*(\d{4,5})\b|\bCMMI\s*(?:-?\s*(?:level|ML|L)\s*-?\s*)?(\d)\b/gi)]
    .map((match) => match[1] ? `ISO ${match[1]}` : `CMMI ${match[2]}`);
  if (certificates.length > 0) {
    const held = profile.certifications.map((certificate) => certificate.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/LEVEL|ML/g, ' ').replace(/\s+/g, ' ').trim());
    const has = (name: string) => {
      const [kind, number] = name.toUpperCase().split(' ');
      return held.some((certificate) => certificate.startsWith(kind) && (kind === 'CMMI'
        ? Number(certificate.match(/\d/)?.[0] ?? 0) >= Number(number)
        : certificate.includes(number)));
    };
    const missing = [...new Set(certificates)].filter((name) => !has(name));
    // "ISO 9001 or ISO 27001": one is enough when the criterion says "or".
    const either = /\bor\b/i.test(flat) && missing.length < new Set(certificates).size;
    return missing.length === 0 || either
      ? result('MET', `Asks for ${[...new Set(certificates)].join(either ? ' or ' : ', ')}; you hold it.`)
      : result('NOT_MET', `Asks for ${missing.join(', ')}; not in your certificates.`);
  }
  const years = /experience|in\s+operation|operating|existence|in\s+business|incorporat|establish/i.test(flat) ? YEARS.exec(flat) : null;
  if (years) {
    const wanted = count(years[1]);
    if (wanted === null) return result('CHECK', 'Asks for years in business; the number could not be read.');
    if (profile.yearsInBusiness === null) return result('CHECK', `Asks for ${wanted} years; your years in business are not filled in.`);
    return profile.yearsInBusiness >= wanted
      ? result('MET', `Asks for ${wanted} years; you have ${profile.yearsInBusiness}.`)
      : result('NOT_MET', `Asks for ${wanted} years; you have ${profile.yearsInBusiness}.`);
  }
  if (/\b(?:registered|incorporated)\b/i.test(flat) && /compan|LLP|partnership|proprietor|societ/i.test(flat)) {
    if (!profile.legalForm) return result('CHECK', 'Asks for a kind of registered firm; your firm type is not filled in.');
    const named: Record<Exclude<LegalForm, ''>, RegExp> = {
      PRIVATE_LIMITED: /compan/i, PUBLIC_LIMITED: /compan/i, LLP: /\bLLP\b|limited\s+liability\s+partnership/i,
      PARTNERSHIP: /partnership(?!\s+act,\s*2008)/i, PROPRIETORSHIP: /proprietor/i, SOCIETY: /societ/i,
    };
    return named[profile.legalForm].test(flat)
      ? result('MET', 'Your kind of firm is one it accepts.')
      : result('NOT_MET', 'Your kind of firm is not one it names.');
  }
  return result('CHECK', 'Read this one yourself: TenderAssist cannot check it from your company facts.');
}

/** Whether the company's facts have been filled in enough to check anything. */
export function isProfileFilled(profile: CompanyProfile): boolean {
  return profile.averageTurnoverLakh !== null || profile.yearsInBusiness !== null || profile.projects.length > 0 || profile.companyName.trim() !== '';
}

/**
 * Every eligibility criterion of a tender, checked: GeM's own turnover and
 * experience asks, the points of its pre-qualification section, and any
 * buyer term that limits who may bid.
 */
export function checkQualification(
  sections: readonly QualificationSection[],
  gem: GemQualificationFacts | null,
  profile: CompanyProfile,
  now = new Date(),
): QualifyReport {
  const checks: CriterionCheck[] = [];
  if (gem?.minimumTurnover) {
    const relaxation = [gem.mseRelaxation && `MSE relaxation: ${gem.mseRelaxation}`, gem.startupRelaxation && `startup relaxation: ${gem.startupRelaxation}`].filter(Boolean).join('; ');
    // GeM's "Yes | Complete" exempts MSEs (or startups) from the turnover ask altogether.
    const exempt = (profile.mse && /^yes\b[^;]*complete/i.test(gem.mseRelaxation ?? '')) || (profile.startup && /^yes\b/i.test(gem.startupRelaxation ?? ''));
    checks.push(exempt
      ? { requirement: `Minimum average annual turnover ${gem.minimumTurnover}; ${relaxation}`, status: 'MET', reason: 'GeM exempts your company from the turnover ask (MSE or startup relaxation).', source: 'GeM bid document' }
      : checkCriterion(`Minimum average annual turnover ${gem.minimumTurnover}${relaxation ? `; ${relaxation.replace(/Turn over value - (\d+) \(in lakhs\)/i, 'relaxed to $1 lakh')}` : ''}`, profile, 'GeM bid document', now));
  }
  if (gem?.pastExperience) {
    const exempt = profile.startup && /^yes\b/i.test(gem.startupRelaxation ?? '') || (profile.mse && /^yes\b[^;]*complete/i.test(gem.mseRelaxation ?? ''));
    checks.push(exempt
      ? { requirement: `${gem.pastExperience} of past experience`, status: 'MET', reason: 'GeM exempts your company from the experience ask (MSE or startup relaxation).', source: 'GeM bid document' }
      : checkCriterion(`${gem.pastExperience} of past experience in the same or similar service`, profile, 'GeM bid document', now));
  }
  const criteria = sections.find((section) => section.kind === 'PRE_QUALIFICATION');
  if (criteria) {
    const source = `${criteria.document}${criteria.page ? `, page ${criteria.page}` : ''}`;
    for (const point of criteria.items.length > 0 ? criteria.items : [criteria.text]) checks.push(checkCriterion(point, profile, source, now));
  }
  for (const section of sections.filter((entry) => entry.kind === 'BUYER_TERMS')) {
    for (const term of section.items.length > 0 ? section.items : [section.text]) {
      const check = checkCriterion(term, profile, `${section.document} (buyer’s terms)`, now);
      // The buyer's terms are many; only those limiting who may bid, or all of them when no criteria section was found.
      if (/firms named|named or shortlisted/.test(check.reason) || (!criteria && check.status !== 'CHECK')) checks.unshift(check);
    }
  }
  return {
    checks,
    met: checks.filter((check) => check.status === 'MET').length,
    notMet: checks.filter((check) => check.status === 'NOT_MET').length,
    toCheck: checks.filter((check) => check.status === 'CHECK').length,
    profileFilled: isProfileFilled(profile),
  };
}
