import type { OpportunityLifecycle } from '../state/opportunityLifecycle.js';

// Which bids were sent, won and lost, overall and by category and intent
// word: what the office wins, so its words and categories can follow it.

export interface BidRecord {
  lifecycle: OpportunityLifecycle;
  category: string | null;
  /** The intent or search words that kept it. */
  words: readonly string[];
}

export interface BidResultLine {
  name: string;
  submitted: number;
  won: number;
  lost: number;
}

export interface BidResults {
  approved: number;
  submitted: number;
  notSubmitted: number;
  won: number;
  lost: number;
  byCategory: BidResultLine[];
  byWord: BidResultLine[];
}

const APPROVED: readonly OpportunityLifecycle[] = ['APPROVED', 'DOCUMENTS_COLLECTED', 'ELIGIBILITY_REVIEWED', 'PREPARING', 'SUBMITTED', 'NOT_SUBMITTED', 'WON', 'LOST'];
const SENT: readonly OpportunityLifecycle[] = ['SUBMITTED', 'WON', 'LOST'];

function lines(records: readonly BidRecord[], namesOf: (record: BidRecord) => string[]): BidResultLine[] {
  const byName = new Map<string, BidResultLine>();
  for (const record of records.filter((entry) => SENT.includes(entry.lifecycle))) {
    for (const name of new Set(namesOf(record))) {
      const line = byName.get(name) ?? { name, submitted: 0, won: 0, lost: 0 };
      line.submitted += 1;
      if (record.lifecycle === 'WON') line.won += 1;
      if (record.lifecycle === 'LOST') line.lost += 1;
      byName.set(name, line);
    }
  }
  return [...byName.values()].sort((a, b) => b.won - a.won || b.submitted - a.submitted || a.name.localeCompare(b.name));
}

export function bidResults(records: readonly BidRecord[]): BidResults {
  const count = (states: readonly OpportunityLifecycle[]) => records.filter((record) => states.includes(record.lifecycle)).length;
  return {
    approved: count(APPROVED),
    submitted: count(SENT),
    notSubmitted: count(['NOT_SUBMITTED']),
    won: count(['WON']),
    lost: count(['LOST']),
    byCategory: lines(records, (record) => [record.category?.trim() || 'Not stated']),
    byWord: lines(records, (record) => record.words.map((word) => word.toLowerCase())),
  };
}
