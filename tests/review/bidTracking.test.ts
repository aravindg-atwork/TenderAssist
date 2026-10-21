import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { checklistFor, dueReminders } from '../../src/review/bidChecklist.js';
import { bidResults } from '../../src/review/bidResults.js';
import { runMigrations } from '../../src/persistence/migrate.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { OpportunityRepository } from '../../src/persistence/repositories/opportunityRepository.js';
import { BidTrackingRepository } from '../../src/persistence/repositories/bidTrackingRepository.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { describeTimeline } from '../../src/review/timeline.js';

describe('the bid checklist', () => {
  it('lists GeM’s documents, the buyer’s asks and the criteria’s evidence, then what every bid needs', () => {
    const entries = checklistFor({
      fields: [
        { label: 'Documents Required from Seller', value: 'Experience Criteria,Bidder Turnover,Additional Doc 1 (Requested in ATC)' },
        { label: 'EMD Amount in ₹', value: '15,00,000' },
      ],
      sections: [
        { kind: 'PRE_QUALIFICATION', heading: '5.5 Criteria', document: 'RFP.pdf', page: 32, text: '', items: [
          '1 Legal Entity The Bidder should be a company incorporated in India. Copy of Certificate of Incorporation; Copy of PAN',
          '2 Turnover at least INR 40 Crore; proof is submitted with the proposal. Copy of PAN',
        ] },
        { kind: 'BUYER_TERMS', heading: 'Buyer Added text based ATC clauses', document: 'GeM bid.pdf', page: null, text: '', items: ['1. Submit copy of Income Tax Return and Pan Card.', '2. The buyer may extend.'] },
      ],
      gem: true,
      closingDate: '03-Nov-2026 11:00 AM',
    });
    expect(entries.map((entry) => [entry.from, entry.label])).toEqual([
      ['GeM bid', 'Experience Criteria'],
      ['GeM bid', 'Bidder Turnover'],
      ['GeM bid', 'Additional Doc 1 (as the buyer’s terms ask)'],
      ['Buyer’s terms', 'Submit copy of Income Tax Return and Pan Card'],
      ['RFP.pdf, page 32', 'Copy of Certificate of Incorporation'],
      ['RFP.pdf, page 32', 'Copy of PAN'],
      ['GeM bid', 'EMD of ₹15,00,000 (or proof of exemption, such as Udyam registration)'],
      ['Every bid', 'Technical bid: every document the tender asks for, signed and stamped'],
      ['Every bid', 'Price bid (BoQ or price schedule) filled in'],
      ['Every bid', 'Bid signed with the DSC and submitted before 03-Nov-2026 11:00 AM'],
    ]);
  });
});

describe('the bid checklist of a Tamil Nadu tender', () => {
  it('starts with the files its cover list asks for', () => {
    const entries = checklistFor({
      fields: [{ label: 'EMD Amount in ₹', value: '10,00,000' }],
      sections: [],
      gem: false,
      closingDate: '29-Oct-2026 05:00 PM',
      covers: [
        { cover: 'Fee/PreQual/Technical', documents: [{ type: 'PDF', description: 'Self-attested PAN copy, latest Income Tax Return filed' }] },
        { cover: 'Finance', documents: [{ type: 'XLS', description: 'BOQ' }] },
      ],
    });
    expect(entries.slice(0, 3).map((entry) => entry.label)).toEqual([
      'Cover 1 (Fee/PreQual/Technical): Self-attested PAN copy, latest Income Tax Return filed (PDF)',
      'Cover 2 (Finance): BOQ (XLS)',
      'EMD of ₹10,00,000 (or proof of exemption, such as Udyam registration)',
    ]);
  });
});

describe('reminders', () => {
  const now = new Date('2026-10-21T04:30:00Z'); // 10:00 IST
  const tender = { opportunityId: 'o1', title: 'WDRA app', closingAt: '2026-10-23T05:30:00Z', preBidAt: '2026-10-21T10:30:00Z' };

  it('reminds of a pre-bid meeting within a day and a closing within 3 days, each once', () => {
    const due = dueReminders([tender], new Set(), now);
    expect(due.map((reminder) => reminder.title)).toEqual(['Pre-bid meeting soon', 'Closes in 3 days']);
    expect(due[0].body).toBe('WDRA app: pre-bid meeting 21 Oct, 4:00 pm.');
    expect(dueReminders([tender], new Set(due.map((reminder) => `o1|${reminder.key}`)), now)).toEqual([]);
    expect(dueReminders([{ ...tender, preBidAt: null }], new Set(), new Date('2026-10-22T08:00:00Z')).map((reminder) => reminder.title)).toEqual(['Closes within a day']);
    expect(dueReminders([tender], new Set(), new Date('2026-10-24T00:00:00Z'))).toEqual([]);
  });
});

describe('bid progress and results', () => {
  it('marks an approved tender preparing, submitted, then won, and counts it by category and word', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const job = new JobRepository(db).create();
    const tender = new TenderRepository(db).upsert({
      jobId: job.id, tenderRef: 'GEM/2026/B/1', tenderPortalId: '1', title: 'Mobile app', organisationChain: null,
      publishedDate: null, closingDate: null, openingDate: null, productCategory: 'Custom Bid for Services', valueInRupees: '',
    });
    const opportunities = new OpportunityRepository(db);
    const opportunity = opportunities.recordSighting(tender, 'gem', { jobId: job.id });
    opportunities.decide([opportunity.id], 'APPROVE');
    expect(opportunities.markProgress(opportunity.id, 'PREPARING').lifecycle).toBe('PREPARING');
    expect(opportunities.markProgress(opportunity.id, 'SUBMITTED').lifecycle).toBe('SUBMITTED');
    expect(opportunities.markProgress(opportunity.id, 'WON').lifecycle).toBe('WON');
    // A slip is put back.
    expect(opportunities.markProgress(opportunity.id, 'SUBMITTED').lifecycle).toBe('SUBMITTED');
    expect(() => opportunities.markProgress(opportunity.id, 'NOT_SUBMITTED')).toThrow();
    expect(describeTimeline(opportunities.listEvents(opportunity.id)).filter((entry) => entry.actor === 'operator').map((entry) => entry.title))
      .toEqual(expect.arrayContaining(['Preparing the bid', 'Bid submitted', 'Won']));

    const tracking = new BidTrackingRepository(db);
    tracking.setTick(opportunity.id, 'copy of pan', true);
    tracking.setTick(opportunity.id, 'copy of pan', true);
    expect([...tracking.ticks(opportunity.id)]).toEqual(['copy of pan']);
    tracking.setTick(opportunity.id, 'copy of pan', false);
    expect(tracking.ticks(opportunity.id).size).toBe(0);
    tracking.markReminderSent(opportunity.id, 'close3:x');
    expect(tracking.sentReminders()).toEqual(new Set([`${opportunity.id}|close3:x`]));
  });

  it('counts bids by category and intent word', () => {
    const results = bidResults([
      { lifecycle: 'WON', category: 'Custom Bid for Services', words: ['Mobile Application'] },
      { lifecycle: 'LOST', category: 'Custom Bid for Services', words: ['website development'] },
      { lifecycle: 'SUBMITTED', category: 'Application Development', words: ['mobile application'] },
      { lifecycle: 'NOT_SUBMITTED', category: 'Application Development', words: [] },
      { lifecycle: 'APPROVED', category: null, words: [] },
    ]);
    expect(results).toMatchObject({ approved: 5, submitted: 3, notSubmitted: 1, won: 1, lost: 1 });
    expect(results.byCategory).toEqual([
      { name: 'Custom Bid for Services', submitted: 2, won: 1, lost: 1 },
      { name: 'Application Development', submitted: 1, won: 0, lost: 0 },
    ]);
    expect(results.byWord[0]).toEqual({ name: 'mobile application', submitted: 2, won: 1, lost: 0 });
  });
});
