import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { BID_TEXT } from './bidTextFixture.js';
import { factsFromBidText } from '../../src/gem/gemBidDocument.js';
import { correctedReverseAuction, withParentFacts } from '../../src/gem/gemRunner.js';
import { runMigrations } from '../../src/persistence/migrate.js';
import { OpportunityRepository } from '../../src/persistence/repositories/opportunityRepository.js';

// The date lines of a real RA PDF (GEM/2026/R/756118, read 21 Oct 2026).
const RA_TEXT = `Dated: 21-10-2026
RA Start Date/Time 22-10-2026 13:00:00
RA End Date/Time 26-10-2026 13:00:00
extension in offer validity by 30 days by the date of RA initiation.`;

describe('reverse auction dates', () => {
  it('reads an RA’s closing time from “RA End Date/Time”', () => {
    expect(factsFromBidText(RA_TEXT).bidEndsAt).toBe('26-10-2026 13:00:00');
  });

  it('never takes the original bid’s end, opening or pre-bid dates, but fills other gaps from it', () => {
    const parent = factsFromBidText(BID_TEXT);
    const merged = withParentFacts(factsFromBidText(RA_TEXT), parent)!;
    expect(merged.bidEndsAt).toBe('26-10-2026 13:00:00');
    expect(merged.bidOpensAt).toBeNull();
    expect(merged.preBidAt).toBeNull();
    expect(merged.minimumTurnover).toBe(parent.minimumTurnover);
    expect(withParentFacts(null, parent)!.bidEndsAt).toBeNull();
  });

  it('corrects an RA saved with its original bid’s dates, once', () => {
    const saved = {
      closing_date: '03-Oct-2026 07:00 PM',
      detail_text: `Bid Number: GEM/2026/R/756118\nBid Submission End Date: 03-Oct-2026 07:00 PM\nBid Opening Date: 03-10-2026 19:30:00\nQuantity: 4\n\n${RA_TEXT}`,
    };
    const corrected = correctedReverseAuction(saved)!;
    expect(corrected.closingDate).toBe('26-Oct-2026 01:00 PM');
    expect(corrected.detailText).toBe(`Bid Number: GEM/2026/R/756118\nBid Submission End Date: 26-Oct-2026 01:00 PM\nQuantity: 4\n\n${RA_TEXT}`);
    expect(correctedReverseAuction({ closing_date: corrected.closingDate, detail_text: corrected.detailText })).toBeNull();
    expect(correctedReverseAuction({ closing_date: null, detail_text: `Bid Number: GEM/2026/B/1\n\n${BID_TEXT}` })).toBeNull();
  });

  it('opens again a tender that closed only because of the wrong date, without marking it changed', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    const opportunities = new OpportunityRepository(db);
    const opportunity = opportunities.recordSighting({
      id: 'tender-1', tender_ref: 'GEM/2026/R/756118', tender_portal_id: '756118', title: 'Housekeeping services', organisation_chain: null,
      department: null, state_name: null, published_date: '2026-10-21T13:00:00+05:30', closing_date: '03-Oct-2026 07:00 PM', value_in_rupees: '',
    } as Parameters<OpportunityRepository['recordSighting']>[0], 'gem');
    opportunities.expireOverdue(new Date('2026-10-21T08:00:00Z'));
    expect(opportunities.getById(opportunity.id)!.lifecycle).toBe('EXPIRED');

    opportunities.correctClosingDate(opportunity.id, '26-Oct-2026 01:00 PM', new Date('2026-10-21T09:00:00Z'));
    const after = opportunities.getById(opportunity.id)!;
    expect(after).toMatchObject({ lifecycle: 'NEW', closing_date: '26-Oct-2026 01:00 PM', closing_at: '2026-10-26T07:30:00.000Z', changed_since_decision: 0 });
  });
});
