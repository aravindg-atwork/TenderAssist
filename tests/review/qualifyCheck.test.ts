import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { amountsInLakh, checkCriterion, checkQualification, EMPTY_COMPANY_PROFILE, type CompanyProfile } from '../../src/review/qualifyCheck.js';
import type { QualificationSection } from '../../src/extraction/qualificationSections.js';
import { runMigrations } from '../../src/persistence/migrate.js';
import { CompanyProfileRepository } from '../../src/persistence/repositories/companyProfileRepository.js';

const COMPANY: CompanyProfile = {
  companyName: 'Bow and Baan Technologies Pvt Ltd', legalForm: 'PRIVATE_LIMITED', yearsInBusiness: 6, averageTurnoverLakh: 1200,
  positiveNetWorth: true, mse: true, startup: false, technicalStaff: 8, certifications: ['ISO 9001:2015', 'CMMI Level 3'], blacklisted: false,
  projects: [
    { name: 'State portal', valueLakh: 150, year: 2025 },
    { name: 'Citizen app', valueLakh: 90, year: 2024 },
    { name: 'District website', valueLakh: 12, year: 2022 },
  ],
};
const NOW = new Date('2026-10-21T10:00:00+05:30');
const check = (text: string, profile = COMPANY) => checkCriterion(text, profile, 'RFP.pdf', NOW);

describe('do we qualify?', () => {
  it('reads money as tenders write it, in lakh', () => {
    expect(amountsInLakh('at least INR 40 Crore')).toEqual([4000]);
    expect(amountsInLakh('Rs. 50 lakh and Rs.50,00,000/-')).toEqual([50, 50]);
    expect(amountsInLakh('3999 Lakh (s)')).toEqual([3999]);
    expect(amountsInLakh('more than Rupees 45 Lakhs')).toEqual([45]);
    expect(amountsInLakh('Rupees 2,50,00,000')).toEqual([250]);
    expect(amountsInLakh('in the last 3 financial years (FY 2023-24)')).toEqual([]);
  });

  it('uses the MSE relaxation of a turnover ask when the company is an MSE', () => {
    const text = '2 Sales Turnover The Bidder shall have an average annual revenue/sales turnover of at least INR 40 Crore in the last three financial years. Relaxation for Startups/MSME Bidders: Minimum average annual turnover of INR 8 Crore.';
    expect(check(text)).toMatchObject({ status: 'MET', reason: 'Asks for ₹8 Cr (the MSE relaxation); you have ₹12 Cr.' });
    expect(check(text, { ...COMPANY, mse: false })).toMatchObject({ status: 'NOT_MET', reason: 'Asks for ₹40 Cr; you have ₹12 Cr.' });
    expect(check(text, { ...COMPANY, averageTurnoverLakh: null })).toMatchObject({ status: 'CHECK' });
  });

  it('counts past projects by value and years', () => {
    const text = 'The Bidder shall have successfully completed at least Two (2) mobile application projects of similar nature with project value not less than INR 1 Crore each, in the last three (3) financial years.';
    expect(check(text)).toMatchObject({ status: 'NOT_MET', reason: 'Asks for 2 similar projects of ₹1 Cr or more each since 2023; you have 1 that fit.' });
    expect(check('Bidder should have developed at least one portal of similar nature.')).toMatchObject({ status: 'MET' });
    expect(check(text, { ...COMPANY, projects: [] })).toMatchObject({ status: 'CHECK' });
  });

  it('checks years, staff, certificates, net worth and blacklisting', () => {
    expect(check('The bidder should have minimum 3 years’ experience in website development.')).toMatchObject({ status: 'MET', reason: 'Asks for 3 years; you have 6.' });
    expect(check('Operating in India for at least ten (10) years.')).toMatchObject({ status: 'NOT_MET' });
    expect(check('The Bidder shall have a minimum of 5 (five) key in-house technical personnel.')).toMatchObject({ status: 'MET', reason: 'Asks for 5 staff; you have 8.' });
    expect(check('The bidder must hold ISO 27001 certification.')).toMatchObject({ status: 'NOT_MET', reason: 'Asks for ISO 27001; not in your certificates.' });
    expect(check('The bidder must hold ISO 9001 or ISO 27001 certification.')).toMatchObject({ status: 'MET' });
    expect(check('CMMI Level 3 or above.')).toMatchObject({ status: 'MET' });
    expect(check('The Bidder shall show positive net worth for three years.')).toMatchObject({ status: 'MET' });
    expect(check('The Bidder should not have been blacklisted by any Government department.')).toMatchObject({ status: 'MET' });
    expect(check('The Bidder should not have been blacklisted.', { ...COMPANY, blacklisted: true })).toMatchObject({ status: 'NOT_MET' });
  });

  it('knows when only named firms may bid', () => {
    const terms = 'Only Bidders shortlisted pursuant to the said EoI shall be eligible: (a) M/s SUCCESSIVE TECHNOLOGIES PRIVATE LIMITED (b) M/s CMS COMPUTERS INDIA PRIVATE LIMITED';
    expect(check(terms)).toMatchObject({ status: 'NOT_MET' });
    expect(check(terms, { ...COMPANY, companyName: 'CMS Computers India Pvt. Ltd.' })).toMatchObject({ status: 'MET' });
  });

  it('leaves what it cannot check to the bidder, never guessing it is met', () => {
    expect(check('The Bidder shall comply with Government of India IT policies, MeitY guidelines and CERT-In advisories.')).toMatchObject({ status: 'CHECK' });
  });

  it('checks GeM’s own asks and a tender’s criteria, the buyer’s limit on who may bid first', () => {
    const sections: QualificationSection[] = [
      { kind: 'PRE_QUALIFICATION', heading: '5.5 Criteria', document: 'RFP.pdf', page: 32, text: '', items: ['1 Net Worth positive net worth.', '2 Security as per CERT-In.'] },
      { kind: 'BUYER_TERMS', heading: 'Buyer Added text based ATC clauses', document: 'GeM bid.pdf', page: null, text: '', items: ['1. Only the following BIDDERS are eligible: (a) M/s CMS COMPUTERS', '2. Submit the PBG.'] },
    ];
    const report = checkQualification(sections, { minimumTurnover: '3999 Lakh (s)', pastExperience: '3 Year (s)', mseRelaxation: 'Yes | Partial | Turn over value - 800 (in lakhs)' }, COMPANY, NOW);
    expect(report.checks.map((entry) => [entry.status, entry.source])).toEqual([
      ['NOT_MET', 'GeM bid.pdf (buyer’s terms)'],
      ['MET', 'GeM bid document'],
      ['MET', 'GeM bid document'],
      ['MET', 'RFP.pdf, page 32'],
      ['CHECK', 'RFP.pdf, page 32'],
    ]);
    expect(report.checks[1].reason).toBe('Asks for ₹8 Cr (the MSE relaxation); you have ₹12 Cr.');
    expect(report).toMatchObject({ met: 3, notMet: 1, toCheck: 1, profileFilled: true });
    // GeM's "Yes | Complete" relaxation exempts an MSE from the turnover ask.
    expect(checkQualification([], { minimumTurnover: '5000 Lakh (s)', mseRelaxation: 'Yes | Complete' }, { ...COMPANY, averageTurnoverLakh: 10 }, NOW).checks[0].status).toBe('MET');
    expect(checkQualification([], null, EMPTY_COMPANY_PROFILE, NOW).profileFilled).toBe(false);
  });
});

describe('the company profile', () => {
  it('is saved tidied and read back', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const repository = new CompanyProfileRepository(db);
    expect(repository.get()).toEqual(EMPTY_COMPANY_PROFILE);
    repository.save({ ...COMPANY, companyName: '  Bow  and Baan ', legalForm: 'NOT_A_FORM', certifications: ['ISO 9001', 'ISO 9001', ''], projects: [{ name: '', valueLakh: null, year: null }, ...COMPANY.projects] });
    expect(repository.get()).toEqual({ ...COMPANY, companyName: 'Bow and Baan', legalForm: '', certifications: ['ISO 9001'] });
    expect(() => repository.save({ averageTurnoverLakh: -5 })).toThrow('0 or more');
  });
});
