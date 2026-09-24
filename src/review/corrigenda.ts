import type { EventContext, OpportunityRepository } from '../persistence/repositories/opportunityRepository.js';
import { canTransition } from '../state/opportunityLifecycle.js';

// Turns the corrigenda a portal lists for a tender into CORRIGENDUM events.
// The portal-specific parser only has to produce `PortalCorrigendum` rows;
// everything after that lives here and is portal-independent.

export type CorrigendumChange = 'DEADLINE' | 'BOQ' | 'FEE' | 'TECHNICAL_DOCUMENT' | 'CANCELLATION';

/** One row of the portal's own corrigendum listing, as a parser reads it. */
export interface PortalCorrigendum {
  /** Number exactly as the portal lists it; never inferred from IDs, titles, or file names. */
  portalNumber: string | null;
  /** Corrigendum title or type column, when the portal shows one. */
  title?: string | null;
  description?: string | null;
  publishedAt: string | null;
}

// Order matters only for display. Each rule looks at the corrigendum's own
// title and description, never at the tender title.
const CHANGE_RULES: Array<{ change: CorrigendumChange; pattern: RegExp }> = [
  { change: 'DEADLINE', pattern: /\b(?:date|dates|deadline|time\s+extension|extension|extended|extend|postpone[ds]?|prepone[ds]?|closing|due\s+date|submission\s+end|bid\s+opening|opening\s+date|schedule\s+change)\b/i },
  { change: 'BOQ', pattern: /\b(?:boq|bill\s+of\s+quantit(?:y|ies)|price\s+bid|financial\s+bid)\b/i },
  { change: 'FEE', pattern: /\b(?:fee|fees|emd|earnest\s+money|bid\s+security|tender\s+cost|document\s+cost)\b/i },
  { change: 'TECHNICAL_DOCUMENT', pattern: /\b(?:specifications?|technical|tender\s+document|nit|scope|eligibility|qualification|terms\s+and\s+conditions|drawings?)\b/i },
];

// Deliberately narrow: "cancellation of corrigendum 2" must not cancel the tender.
const CANCELLATION = /\b(?:tender|bid|nit|work|e-?tender)\s+(?:is\s+|has\s+been\s+|stands\s+|hereby\s+)*(?:cancell?ed|withdrawn|annulled|scrapped)\b|\bcancell?ation\s+of\s+(?:the\s+)?(?:tender|bid|nit|e-?tender)\b|^\s*(?:tender\s+)?cancell?ed\s*$/im;

/** What a corrigendum changed, from its own title and description. Empty when it does not say. */
export function classifyCorrigendum(entry: Pick<PortalCorrigendum, 'title' | 'description'>): CorrigendumChange[] {
  const text = [entry.title, entry.description].filter(Boolean).join('\n');
  if (!text.trim()) return [];
  const changes: CorrigendumChange[] = CHANGE_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.change);
  if (CANCELLATION.test(text)) changes.push('CANCELLATION');
  return changes;
}

/**
 * Records every listed corrigendum on the tender, once per portal number.
 * A corrigendum that cancels the tender also moves it to CANCELLED.
 * Returns how many corrigenda were new.
 */
export function applyPortalCorrigenda(
  opportunities: Pick<OpportunityRepository, 'getById' | 'listEvents' | 'recordCorrigendum' | 'markCancelled'>,
  opportunityId: string,
  entries: PortalCorrigendum[],
  context: EventContext = {}
): number {
  const known = () => opportunities.listEvents(opportunityId).filter((event) => event.kind === 'CORRIGENDUM').length;
  const before = known();
  let cancelledBy: string | null | undefined;
  for (const entry of entries) {
    const changes = classifyCorrigendum(entry);
    opportunities.recordCorrigendum(opportunityId, {
      portalNumber: entry.portalNumber,
      publishedAt: entry.publishedAt,
      changes,
      description: [entry.title, entry.description].filter(Boolean).join(' — ') || null,
    }, context);
    if (changes.includes('CANCELLATION')) cancelledBy = entry.portalNumber;
  }
  const current = opportunities.getById(opportunityId);
  if (cancelledBy !== undefined && current && current.lifecycle !== 'CANCELLED' && canTransition(current.lifecycle, 'CANCELLED')) {
    opportunities.markCancelled(opportunityId, context, { corrigendum: cancelledBy });
  }
  return known() - before;
}
