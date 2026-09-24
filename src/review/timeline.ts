import type { OpportunityEventRow } from '../persistence/repositories/opportunityRepository.js';
import { explainScreening, parseScreenedGates } from './tenderExplanation.js';

export interface TimelineEntry {
  id: string;
  at: string;
  actor: 'automation' | 'operator';
  title: string;
  detail: string | null;
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
        return { ...base, title: 'Portal details changed', detail: changeDetail(data.changes) };
      case 'CORRIGENDUM': {
        const number = typeof data.portalNumber === 'string' && data.portalNumber ? ` ${data.portalNumber}` : '';
        const changes = Array.isArray(data.changes) ? data.changes.filter((item): item is string => typeof item === 'string') : [];
        return {
          ...base,
          title: `Corrigendum${number} published`,
          detail: changes.length ? `Changes: ${changes.map((change) => change.toLowerCase().replace(/_/g, ' ')).join(', ')}` : null,
        };
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
      case 'NOTE':
        return { ...base, title: 'Note', detail: event.note };
    }
  });
}
