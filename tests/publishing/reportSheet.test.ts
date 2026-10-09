import { describe, expect, it } from 'vitest';
import { projectNature, reportDate, reportRow, shortTitle } from '../../src/publishing/reportSheet.js';
import type { TenderRow } from '../../src/persistence/repositories/tenderRepository.js';

const base: TenderRow = {
  id: 't1', job_id: 'j1', tender_ref: 'TNUSRB/B2/3461/2026', tender_portal_id: '2026_POLIS_702131_1', title: 'OARS',
  organisation_chain: 'Police Department||Tamil Nadu Uniformed Services Recruitment Board', department: null, state_name: 'Tamil Nadu',
  published_date: '2026-09-16T14:15:00+05:30', closing_date: '05-Oct-2026 05:00 PM', opening_date: null, product_category: 'Information Technology',
  value_in_rupees: 'NA', favorited: 1, favorited_at: null, detail_product_category: null, tender_category: null,
  detail_text: [
    'Tender ID: 2026_POLIS_702131_1', 'Work Description: Developing and Hosting Online Application and Registration System',
    'EMD Amount in ₹: 20,000', 'Tender Value in ₹: NA', 'Location: TNUSRB, Chennai', 'Pincode: 600008',
    'Pre Bid Meeting Date: 23-Sep-2026 12:30 PM', 'Bid Submission Start Date: 25-Sep-2026 10:30 AM', 'Bid Submission End Date: 05-Oct-2026 05:00 PM',
    '', 'page text',
  ].join('\n'),
  detail_reviewed_at: null, document_links_json: '[]', created_at: '', updated_at: '',
};

describe('the day report sheet', () => {
  it('fills a Tamil Nadu tender from its portal fields', () => {
    expect(reportRow({ tender: base, serialNumber: 3, portalUrl: 'https://tntenders.gov.in/nicgep/app', portalName: 'Tamil Nadu', documentsFolder: '05-10-2026_3_OARS/Documents' })).toEqual({
      serialNumber: 3,
      tdrNumber: '2026_POLIS_702131_1',
      department: 'Tamil Nadu Uniformed Services Recruitment Board',
      location: 'TNUSRB, Chennai - 600008',
      shortTitle: 'OARS',
      projectNature: 'Application Dev',
      tenderValue: '',
      bidStartDate: '25-09-2026 10:30 AM',
      bidEndDate: '05-10-2026 05:00 PM',
      emd: '20,000',
      preBidMeetingDate: '23-09-2026 12:30 PM',
      eligibility: 'To check',
      eligibilityNotes: '',
      viewTenderLink: { text: 'Open Tamil Nadu (Tender ID 2026_POLIS_702131_1)', target: 'https://tntenders.gov.in/nicgep/app' },
      tenderDocumentLink: { text: 'Open documents', target: '05-10-2026_3_OARS/Documents' },
      corrigenda: '',
    });
  });

  it('fills a GeM bid, linking to its bid document', () => {
    const row = reportRow({
      serialNumber: 1,
      tender: {
        ...base, tender_ref: 'GEM/2026/B/8085066', tender_portal_id: '9900001', title: 'Custom Bid for Services - Integrated Mobile Application for the WDRA 2 Web Portal',
        detail_text: 'Bid Number: GEM/2026/B/8085066\nTender Value in ₹: 48,95,820\nEMD Amount in ₹: 98,000\nBid Start Date: 06-Oct-2026 11:00 AM\nBid Submission End Date: 27-10-2026 15:00:00\nPre Bid Meeting Date: 15-10-2026 11:00:00\nLocation: Delhi - PIN 110001\nPre-Qualification: minimum average annual turnover 24 Lakh (s)\n\ntext',
      },
    });
    expect(row).toMatchObject({
      tdrNumber: 'GEM/2026/B/8085066', shortTitle: 'Integrated Mobile Application for the WDRA 2 Web Portal',
      projectNature: 'Website / Mobile App', tenderValue: '48,95,820', emd: '98,000', location: 'Delhi - PIN 110001',
      bidStartDate: '06-10-2026 11:00 AM', bidEndDate: '27-10-2026 03:00 PM', preBidMeetingDate: '15-10-2026 11:00 AM',
      eligibilityNotes: 'minimum average annual turnover 24 Lakh (s)',
      viewTenderLink: { text: 'Open on GeM', target: 'https://bidplus.gem.gov.in/showbidDocument/9900001' },
      tenderDocumentLink: null,
    });
  });

  it('names the kind of work in the office’s own words', () => {
    expect(projectNature('E-learning content development (IGOT)')).toBe('E-learning');
    expect(projectNature('Website Redesign & Maintenance (SSC)')).toBe('Website');
    expect(projectNature('Mobile app (Android/iOS) - athlete performance data')).toBe('Mobile App');
    expect(projectNature('Hiring of Agency for IT Projects- Milestone basis')).toBe('Application Dev');
    expect(projectNature('ERP software')).toBe('Software');
    expect(projectNature('Empanelment of software OEMs')).toBe('Empanelment');
    expect(projectNature('Supply of office chairs')).toBe('Other');
  });

  it('shortens titles and writes every date the same way', () => {
    expect(shortTitle(`Custom Bid for Services - ${'x'.repeat(120)}`)).toHaveLength(88);
    expect(reportDate('2026-09-16T14:15:00+05:30')).toBe('16-09-2026 02:15 PM');
    expect(reportDate('2026-09-16')).toBe('16-09-2026');
    expect(reportDate('07-Oct-2026 12:00 PM')).toBe('07-10-2026 12:00 PM');
    expect(reportDate('')).toBe('');
  });
});
