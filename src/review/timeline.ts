import type { OpportunityEventRow } from '../persistence/repositories/opportunityRepository.js';
import { explainScreening, parseScreenedGates } from './tenderExplanation.js';

export interface TimelineEntry {
  id: string;
  at: string;
  actor: 'automation' | 'operator';
  title: string;
  detail: string | null;
  /** A note TenderAssist wrote on the file itself, shown on the noting sheet. */
  automaticNote?: true;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  closing_date: 'Closing date',
  value_in_rupees: 'Value',
};

const RECOMMENDATION_TITLES: Record<string, string> = {
  KEEP: 'Screened: recommended',
  REJECT: 'Screened: rejected automatically',
  UNCERTAIN: 'Screened: needs your judgement',
};

function parse(dataJson: string): Record<string, unknown> {
  try { return JSON.parse(dataJson) as Record<string, unknown>; } catch { return {}; }
}

function changeDetail(changes: unknown): string | null {
  if (typeof changes !== 'object' || changes === null) return null;
  const parts = Object.entries(changes as Record<string, { from?: unknown; to?: unknown } | undefined>).map(([field, change]) =>
    `${FIELD_LABELS[field] ?? field}: ${String(change?.from ?? 'not shown')} → ${String(change?.to ?? 'not shown')}`);
  return parts.length ? parts.join('; ') : null;
}

const CHANGE_LABELS: Record<string, string> = {
  DEADLINE: 'deadline',
  BOQ: 'BOQ',
  FEE: 'fee',
  TECHNICAL_DOCUMENT: 'technical document',
  CANCELLATION: 'cancellation',
};

function changeList(changes: unknown): string[] {
  return Array.isArray(changes)
    ? changes.filter((item): item is string => typeof item === 'string').map((change) => CHANGE_LABELS[change] ?? change.toLowerCase().replace(/_/g, ' '))
    : [];
}

/**
 * One sentence on what changed after the operator last decided, for the
 * Inbox's "Changed since your decision" group. Null when nothing is recorded.
 */
export function describeChangesSinceDecision(events: OpportunityEventRow[]): string | null {
  let start = 0;
  events.forEach((event, index) => { if (event.actor === 'operator') start = index + 1; });
  const parts: string[] = [];
  for (const event of events.slice(start)) {
    const data = parse(event.data_json);
    if (event.kind === 'CANCELLED') parts.push('cancelled by the portal');
    else if (event.kind === 'CHANGED' && data.reopened) {
      parts.push('closing date extended, open again');
    } else if (event.kind === 'CHANGED') {
      const detail = changeDetail(data.changes);
      if (detail) parts.push(detail);
    } else if (event.kind === 'CORRIGENDUM') {
      const number = typeof data.portalNumber === 'string' && data.portalNumber ? ` ${data.portalNumber}` : '';
      const changes = changeList(data.changes);
      parts.push(`Corrigendum${number}${changes.length ? ` (${changes.join(', ')})` : ''}`);
    }
  }
  return parts.length ? `Changed since your decision: ${parts.join('; ')}.` : null;
}

/** One readable line, plus optional detail, per recorded event; oldest first. */
export function describeTimeline(events: OpportunityEventRow[]): TimelineEntry[] {
  return events.map((event) => {
    const data = parse(event.data_json);
    const base = { id: event.id, at: event.created_at, actor: event.actor };
    switch (event.kind) {
      case 'SEEN':
        return { ...base, title: 'Found by a discovery run', detail: null };
      case 'SCREENED': {
        const recommendation = typeof data.recommendation === 'string' ? data.recommendation : '';
        const known = recommendation === 'KEEP' || recommendation === 'REJECT' || recommendation === 'UNCERTAIN' ? recommendation : null;
        return {
          ...base,
          title: RECOMMENDATION_TITLES[recommendation] ?? 'Screened',
          detail: explainScreening(known, parseScreenedGates(event.data_json)).sentence,
        };
      }
      case 'CHANGED':
        if (data.reopened) {
          const closing = typeof data.closingDate === 'string' ? ` It now closes ${data.closingDate}.` : '';
          return { ...base, title: 'Open again: closing date extended', detail: `It had closed; the website extended it.${closing}` };
        }
        return { ...base, title: 'Portal details changed', detail: changeDetail(data.changes) };
      case 'CORRIGENDUM': {
        const number = typeof data.portalNumber === 'string' && data.portalNumber ? ` ${data.portalNumber}` : '';
        const changes = changeList(data.changes);
        const description = typeof data.description === 'string' && data.description ? data.description : null;
        const detail = [changes.length ? `Changes: ${changes.join(', ')}` : null, description].filter(Boolean).join('. ');
        return { ...base, title: `Corrigendum${number} published`, detail: detail || null };
      }
      case 'APPROVED':
        return { ...base, title: 'You approved it', detail: event.note };
      case 'REJECTED':
        return { ...base, title: 'You rejected it', detail: event.note };
      case 'DEFERRED':
        return { ...base, title: 'You deferred it', detail: event.note };
      case 'REOPENED':
        return { ...base, title: 'You moved it back to review', detail: event.note };
      case 'DOCUMENTS_COLLECTED': {
        const count = typeof data.documents === 'number' ? data.documents : null;
        return { ...base, title: count === null ? 'Documents collected' : `Documents collected (${count})`, detail: null };
      }
      case 'EXPIRED':
        return { ...base, title: 'Closing date passed', detail: null };
      case 'CANCELLED': {
        const number = typeof data.corrigendum === 'string' && data.corrigendum ? ` (corrigendum ${data.corrigendum})` : '';
        return { ...base, title: `Cancelled by the portal${number}`, detail: null };
      }
      case 'ACKNOWLEDGED':
        return { ...base, title: 'You noted the change and kept your decision', detail: event.note };
      case 'LINK_DISMISSED': {
        const other = typeof data.otherTenderId === 'string' ? data.otherTenderId : 'another tender';
        return { ...base, title: `You marked it not related to ${other}`, detail: event.note };
      }
      case 'NOTE':
        return { ...base, title: 'Note', detail: event.note, ...(event.actor === 'automation' ? { automaticNote: true as const } : {}) };
    }
  });
}
