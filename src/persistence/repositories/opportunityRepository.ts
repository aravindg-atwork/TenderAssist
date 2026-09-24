import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db.js';
import type { TenderRow } from './tenderRepository.js';
import { parseTenderPortalDate } from '../../search/tenderDateParser.js';
import {
  assertTransition,
  DECIDED_LIFECYCLES,
  DECISION_TARGETS,
  OPEN_LIFECYCLES,
  type OperatorDecision,
  type OpportunityLifecycle,
} from '../../state/opportunityLifecycle.js';

export type Recommendation = 'KEEP' | 'REJECT' | 'UNCERTAIN';
export type OpportunityActor = 'automation' | 'operator';
export type OpportunityEventKind =
  | 'SEEN' | 'SCREENED' | 'CHANGED' | 'CORRIGENDUM'
  | 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'REOPENED'
  | 'DOCUMENTS_COLLECTED' | 'EXPIRED' | 'CANCELLED' | 'ACKNOWLEDGED' | 'LINK_DISMISSED' | 'NOTE';
export type OpportunityLinkKind = 'POSSIBLE_RETENDER';

export interface OpportunityRow {
  id: string;
  workspace_id: string;
  portal_id: string;
  identity_key: string;
  tender_portal_id: string | null;
  tender_ref: string;
  title: string;
  organisation_chain: string | null;
  department: string | null;
  state_name: string | null;
  published_date: string | null;
  closing_date: string | null;
  closing_at: string | null;
  value_in_rupees: string | null;
  lifecycle: OpportunityLifecycle;
  recommendation: Recommendation | null;
  changed_since_decision: 0 | 1;
  inbox_hidden_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  latest_sighting_id: string | null;
  updated_at: string;
}

export interface OpportunityEventRow {
  id: string;
  workspace_id: string;
  opportunity_id: string;
  kind: OpportunityEventKind;
  actor: OpportunityActor;
  actor_id: string | null;
  job_id: string | null;
  note: string | null;
  data_json: string;
  created_at: string;
}

export interface OpportunityLinkRow {
  id: string;
  from_opportunity_id: string;
  to_opportunity_id: string;
  kind: OpportunityLinkKind;
  confirmed_by_operator: 0 | 1;
  created_at: string;
  dismissed_at: string | null;
}

export interface CorrigendumInput {
  /** Number exactly as the portal lists it; never inferred from IDs, titles, or file names. */
  portalNumber: string | null;
  publishedAt: string | null;
  /** e.g. 'DEADLINE', 'BOQ', 'FEE', 'TECHNICAL_DOCUMENT', 'CANCELLATION'. */
  changes: string[];
  description?: string | null;
}

/** A retender link with both tenders, for showing it on either one. */
export interface RetenderLinkRow {
  from_opportunity_id: string;
  to_opportunity_id: string;
  confirmed_by_operator: 0 | 1;
  created_at: string;
}

/** An opportunity plus its latest automatic screening, for the Inbox. */
export interface InboxRow extends OpportunityRow {
  screening_json: string | null;
  screening_job_id: string | null;
  screening_job_reviewed_at: string | null;
  screening_at: string | null;
  /** Latest operator "Move to review"; beats an older automatic reject. */
  reopened_at: string | null;
}

/** Optional context shared by every write: which run caused it and when it happened. */
export interface EventContext {
  jobId?: string | null;
  at?: string;
  note?: string | null;
}

const DECISION_EVENTS: Record<OperatorDecision, OpportunityEventKind> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  DEFER: 'DEFERRED',
  REOPEN: 'REOPENED',
};

// Fields whose change between sightings the operator needs to see.
const TRACKED_FIELDS = ['title', 'closing_date', 'value_in_rupees'] as const;

function normalizeIdentityPart(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase();
}

function meaningful(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.toUpperCase() !== 'NA' ? trimmed : null;
}

function toClosingAt(raw: string | null): string | null {
  if (!raw) return null;
  const portal = parseTenderPortalDate(raw);
  if (portal) return new Date(portal).toISOString();
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function cleanNote(note?: string | null): string | null {
  const cleaned = note?.trim().replace(/\s+/g, ' ') ?? '';
  return cleaned ? cleaned.slice(0, 1000) : null;
}

export class OpportunityRepository {
  constructor(private db: DatabaseSync, private workspaceId = 'local') {}

  /** Tender ID when the portal shows one, otherwise the reference number. */
  static identityKey(tenderPortalId: string | null, tenderRef: string): string {
    return normalizeIdentityPart(tenderPortalId) || normalizeIdentityPart(tenderRef);
  }

  getById(id: string): OpportunityRow | undefined {
    return this.db.prepare('SELECT * FROM opportunities WHERE id = ? AND workspace_id = ?')
      .get(id, this.workspaceId) as OpportunityRow | undefined;
  }

  findByIdentity(portalId: string, identityKey: string): OpportunityRow | undefined {
    return this.db.prepare(
      'SELECT * FROM opportunities WHERE workspace_id = ? AND portal_id = ? AND identity_key = ?'
    ).get(this.workspaceId, portalId, identityKey) as OpportunityRow | undefined;
  }

  list(filter: { lifecycles?: OpportunityLifecycle[]; portalId?: string } = {}): OpportunityRow[] {
    const clauses = ['workspace_id = ?'];
    const params: string[] = [this.workspaceId];
    if (filter.lifecycles?.length) {
      clauses.push(`lifecycle IN (${filter.lifecycles.map(() => '?').join(', ')})`);
      params.push(...filter.lifecycles);
    }
    if (filter.portalId) {
      clauses.push('portal_id = ?');
      params.push(filter.portalId);
    }
    return this.db.prepare(
      `SELECT * FROM opportunities WHERE ${clauses.join(' AND ')} ORDER BY last_seen_at DESC, rowid DESC`
    ).all(...params) as unknown as OpportunityRow[];
  }

  /** Tenders awaiting a decision, and decided tenders that changed since. */
  listInboxRows(): InboxRow[] {
    return this.listWithScreening(
      `((o.lifecycle IN ('NEW', 'SCREENED') AND o.inbox_hidden_at IS NULL) OR o.changed_since_decision = 1)`,
      'o.closing_at IS NULL, o.closing_at ASC, o.last_seen_at DESC'
    );
  }

  /** Every tender in the workspace with its latest screening, newest activity first. */
  listAllWithScreening(): InboxRow[] {
    return this.listWithScreening('1 = 1', 'o.updated_at DESC, o.rowid DESC');
  }

  // `where` and `orderBy` are fixed SQL fragments from this class, never user input.
  private listWithScreening(where: string, orderBy: string): InboxRow[] {
    return this.db.prepare(
      `SELECT o.*, e.data_json AS screening_json, e.job_id AS screening_job_id, j.reviewed_at AS screening_job_reviewed_at,
              e.created_at AS screening_at,
              (SELECT MAX(created_at) FROM opportunity_events WHERE opportunity_id = o.id AND kind = 'REOPENED') AS reopened_at
       FROM opportunities o
       LEFT JOIN opportunity_events e ON e.id = (
         SELECT id FROM opportunity_events
         WHERE opportunity_id = o.id AND kind = 'SCREENED'
         ORDER BY created_at DESC, rowid DESC LIMIT 1)
       LEFT JOIN jobs j ON j.id = e.job_id
       WHERE o.workspace_id = ? AND ${where}
       ORDER BY ${orderBy}`
    ).all(this.workspaceId) as unknown as InboxRow[];
  }

  listEvents(opportunityId: string): OpportunityEventRow[] {
    return this.db.prepare(
      'SELECT * FROM opportunity_events WHERE opportunity_id = ? ORDER BY created_at ASC, rowid ASC'
    ).all(opportunityId) as unknown as OpportunityEventRow[];
  }

  listLinks(opportunityId: string): OpportunityLinkRow[] {
    return this.db.prepare(
      'SELECT * FROM opportunity_links WHERE from_opportunity_id = ? OR to_opportunity_id = ? ORDER BY created_at ASC'
    ).all(opportunityId, opportunityId) as unknown as OpportunityLinkRow[];
  }

  /**
   * Attaches a per-run `tenders` row to its opportunity, creating the
   * opportunity on first sight. Changes to tracked fields are logged and,
   * on a tender the operator already decided, flagged for another look.
   * Safe to call again for the same row: it refreshes values without
   * logging another SEEN.
   */
  recordSighting(tender: TenderRow, portalId: string, context: EventContext = {}): OpportunityRow {
    const at = context.at ?? new Date().toISOString();
    const identityKey = OpportunityRepository.identityKey(tender.tender_portal_id, tender.tender_ref);
    if (!identityKey) throw new Error('A tender needs a Tender ID or reference number to be tracked.');
    const incoming = {
      title: tender.title,
      closing_date: meaningful(tender.closing_date),
      value_in_rupees: meaningful(tender.value_in_rupees),
    };
    return this.inTransaction(() => {
      const alreadyLinked = Boolean((this.db.prepare('SELECT opportunity_id FROM tenders WHERE id = ?')
        .get(tender.id) as { opportunity_id: string | null } | undefined)?.opportunity_id);
      let opportunity = this.findByIdentity(portalId, identityKey);
      if (!opportunity) {
        const id = randomUUID();
        this.db.prepare(
          `INSERT INTO opportunities
           (id, workspace_id, portal_id, identity_key, tender_portal_id, tender_ref, title, organisation_chain,
            department, state_name, published_date, closing_date, closing_at, value_in_rupees, lifecycle,
            first_seen_at, last_seen_at, latest_sighting_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?)`
        ).run(id, this.workspaceId, portalId, identityKey, meaningful(tender.tender_portal_id), tender.tender_ref,
          tender.title, tender.organisation_chain, tender.department ?? null, tender.state_name ?? null,
          tender.published_date, incoming.closing_date, toClosingAt(incoming.closing_date),
          incoming.value_in_rupees, at, at, tender.id, at);
        opportunity = this.getById(id)!;
      } else {
        const changes: Record<string, { from: string | null; to: string | null }> = {};
        for (const field of TRACKED_FIELDS) {
          const next = incoming[field];
          const previous = opportunity[field];
          if (next !== null && next !== previous) changes[field] = { from: previous, to: next };
        }
        if (Object.keys(changes).length > 0) {
          this.insertEvent(opportunity.id, 'CHANGED', 'automation', { ...context, at, note: null }, { tenderId: tender.id, changes });
        }
        const flag = Object.keys(changes).length > 0 && DECIDED_LIFECYCLES.includes(opportunity.lifecycle) ? 1 : opportunity.changed_since_decision;
        const closingDate = incoming.closing_date ?? opportunity.closing_date;
        this.db.prepare(
          `UPDATE opportunities SET
             tender_portal_id = COALESCE(?, tender_portal_id), title = ?,
             organisation_chain = COALESCE(?, organisation_chain), department = COALESCE(?, department),
             state_name = COALESCE(?, state_name), published_date = COALESCE(?, published_date),
             closing_date = ?, closing_at = ?, value_in_rupees = COALESCE(?, value_in_rupees),
             changed_since_decision = ?, last_seen_at = ?, latest_sighting_id = ?, updated_at = ?,
             inbox_hidden_at = CASE WHEN ? THEN inbox_hidden_at ELSE NULL END
           WHERE id = ?`
        ).run(meaningful(tender.tender_portal_id), tender.title, tender.organisation_chain,
          tender.department ?? null, tender.state_name ?? null, tender.published_date,
          closingDate, toClosingAt(closingDate), incoming.value_in_rupees,
          flag, at, tender.id, at, alreadyLinked ? 1 : 0, opportunity.id);
      }
      this.db.prepare('UPDATE tenders SET opportunity_id = ? WHERE id = ?').run(opportunity.id, tender.id);
      if (!alreadyLinked) {
        this.insertEvent(opportunity.id, 'SEEN', 'automation', { ...context, at, note: null }, { tenderId: tender.id });
      }
      return this.getById(opportunity.id)!;
    });
  }

  /**
   * Stores the automatic recommendation. It never rejects on its own; only
   * the operator does. Repeating the same result for the same run is a no-op.
   */
  recordScreening(opportunityId: string, recommendation: Recommendation, context: EventContext = {}, evidence: Record<string, unknown> = {}): OpportunityRow {
    return this.inTransaction(() => {
      const opportunity = this.require(opportunityId);
      if (context.jobId && opportunity.recommendation === recommendation && this.db.prepare(
        `SELECT 1 FROM opportunity_events WHERE opportunity_id = ? AND kind = 'SCREENED' AND job_id = ?`
      ).get(opportunityId, context.jobId)) {
        return opportunity;
      }
      const at = context.at ?? new Date().toISOString();
      if (opportunity.lifecycle === 'NEW') assertTransition('NEW', 'SCREENED');
      this.db.prepare(
        `UPDATE opportunities SET recommendation = ?, lifecycle = CASE WHEN lifecycle = 'NEW' THEN 'SCREENED' ELSE lifecycle END,
         updated_at = ? WHERE id = ?`
      ).run(recommendation, at, opportunityId);
      this.insertEvent(opportunityId, 'SCREENED', 'automation', context, { recommendation, ...evidence });
      return this.getById(opportunityId)!;
    });
  }

  /**
   * Operator decision on one or many tenders, applied atomically: if any
   * transition is illegal, none are written. Repeating the current decision
   * only acknowledges a pending change.
   */
  decide(ids: string[], decision: OperatorDecision, context: EventContext = {}): OpportunityRow[] {
    const target = DECISION_TARGETS[decision];
    return this.inTransaction(() => ids.map((id) => {
      const opportunity = this.require(id);
      const at = context.at ?? new Date().toISOString();
      if (opportunity.lifecycle === target) {
        // REOPEN on a SCREENED auto-reject is the operator overriding
        // automation ("Move to review"), so it is always recorded.
        if (decision !== 'REOPEN' && !opportunity.changed_since_decision && !cleanNote(context.note)) return opportunity;
      } else {
        assertTransition(opportunity.lifecycle, target);
      }
      // Moving a tender back to review must also bring it back into the Inbox.
      this.db.prepare(
        `UPDATE opportunities SET lifecycle = ?, changed_since_decision = 0, updated_at = ?,
           inbox_hidden_at = CASE WHEN ? THEN NULL ELSE inbox_hidden_at END
         WHERE id = ?`
      ).run(target, at, decision === 'REOPEN' ? 1 : 0, id);
      this.insertEvent(id, DECISION_EVENTS[decision], 'operator', context, { from: opportunity.lifecycle });
      return this.getById(id)!;
    }));
  }

  markDocumentsCollected(opportunityId: string, context: EventContext = {}, data: Record<string, unknown> = {}): OpportunityRow {
    return this.transition(opportunityId, 'DOCUMENTS_COLLECTED', 'DOCUMENTS_COLLECTED', 'automation', context, data);
  }

  /**
   * Logs a portal corrigendum on the same Tender ID; it never creates a new
   * tender. A corrigendum already recorded under the same portal number is
   * skipped, so re-reading the portal's list on every run is safe.
   */
  recordCorrigendum(opportunityId: string, corrigendum: CorrigendumInput, context: EventContext = {}): OpportunityRow {
    return this.inTransaction(() => {
      const opportunity = this.require(opportunityId);
      const portalNumber = corrigendum.portalNumber?.trim() || null;
      // Without a portal number, the same date and wording identify it.
      const alreadyRecorded = portalNumber
        ? this.db.prepare(
          `SELECT 1 FROM opportunity_events WHERE opportunity_id = ? AND kind = 'CORRIGENDUM'
           AND json_extract(data_json, '$.portalNumber') = ?`
        ).get(opportunityId, portalNumber)
        : (corrigendum.publishedAt || corrigendum.description) && this.db.prepare(
          `SELECT 1 FROM opportunity_events WHERE opportunity_id = ? AND kind = 'CORRIGENDUM'
           AND json_extract(data_json, '$.portalNumber') IS NULL
           AND json_extract(data_json, '$.publishedAt') IS ? AND json_extract(data_json, '$.description') IS ?`
        ).get(opportunityId, corrigendum.publishedAt ?? null, corrigendum.description ?? null);
      if (alreadyRecorded) return opportunity;
      const at = context.at ?? new Date().toISOString();
      this.insertEvent(opportunityId, 'CORRIGENDUM', 'automation', context, { ...corrigendum, description: corrigendum.description ?? null, portalNumber });
      const flag = DECIDED_LIFECYCLES.includes(opportunity.lifecycle) ? 1 : opportunity.changed_since_decision;
      this.db.prepare('UPDATE opportunities SET changed_since_decision = ?, updated_at = ? WHERE id = ?').run(flag, at, opportunityId);
      return this.getById(opportunityId)!;
    });
  }

  /** Suggests that a new Tender ID relates to an older one. Never merges them. */
  linkPossibleRetender(fromId: string, toId: string, at = new Date().toISOString()): OpportunityLinkRow {
    if (fromId === toId) throw new Error('A tender cannot be linked to itself.');
    this.require(fromId);
    this.require(toId);
    this.db.prepare(
      `INSERT INTO opportunity_links (id, workspace_id, from_opportunity_id, to_opportunity_id, kind, created_at)
       VALUES (?, ?, ?, ?, 'POSSIBLE_RETENDER', ?)
       ON CONFLICT (from_opportunity_id, to_opportunity_id, kind) DO NOTHING`
    ).run(randomUUID(), this.workspaceId, fromId, toId, at);
    return this.db.prepare(
      `SELECT * FROM opportunity_links WHERE from_opportunity_id = ? AND to_opportunity_id = ? AND kind = 'POSSIBLE_RETENDER'`
    ).get(fromId, toId) as unknown as OpportunityLinkRow;
  }

  /** Every retender suggestion in the workspace. */
  listRetenderLinks(): RetenderLinkRow[] {
    return this.db.prepare(
      `SELECT from_opportunity_id, to_opportunity_id, confirmed_by_operator, created_at FROM opportunity_links
       WHERE workspace_id = ? AND kind = 'POSSIBLE_RETENDER' AND dismissed_at IS NULL ORDER BY created_at ASC`
    ).all(this.workspaceId) as unknown as RetenderLinkRow[];
  }

  /**
   * The operator says two tenders are not related. The link is kept as
   * dismissed so the same suggestion never comes back.
   */
  dismissRetenderLink(opportunityId: string, otherId: string, context: EventContext = {}): void {
    this.inTransaction(() => {
      const at = context.at ?? new Date().toISOString();
      const result = this.db.prepare(
        `UPDATE opportunity_links SET dismissed_at = ?
         WHERE kind = 'POSSIBLE_RETENDER' AND dismissed_at IS NULL
           AND ((from_opportunity_id = ? AND to_opportunity_id = ?) OR (from_opportunity_id = ? AND to_opportunity_id = ?))`
      ).run(at, opportunityId, otherId, otherId, opportunityId);
      if (Number(result.changes) === 0) return;
      const other = this.require(otherId);
      this.insertEvent(opportunityId, 'LINK_DISMISSED', 'operator', { ...context, at },
        { otherId, otherTenderId: other.tender_portal_id ?? other.tender_ref });
    });
  }

  /** The portal withdrew the tender. A tender the operator had decided is flagged so they see it. */
  markCancelled(opportunityId: string, context: EventContext = {}, data: Record<string, unknown> = {}): OpportunityRow {
    return this.inTransaction(() => {
      const before = this.require(opportunityId);
      const after = this.transition(opportunityId, 'CANCELLED', 'CANCELLED', 'automation', context, data);
      if (before.lifecycle !== 'CANCELLED' && DECIDED_LIFECYCLES.includes(before.lifecycle)) {
        this.db.prepare('UPDATE opportunities SET changed_since_decision = 1 WHERE id = ?').run(opportunityId);
        return this.getById(opportunityId)!;
      }
      return after;
    });
  }

  /** The operator has seen what changed and keeps their decision as it is. */
  acknowledgeChanges(ids: string[], context: EventContext = {}): OpportunityRow[] {
    return this.inTransaction(() => ids.map((id) => {
      const opportunity = this.require(id);
      if (!opportunity.changed_since_decision) return opportunity;
      const at = context.at ?? new Date().toISOString();
      this.db.prepare('UPDATE opportunities SET changed_since_decision = 0, updated_at = ? WHERE id = ?').run(at, id);
      this.insertEvent(id, 'ACKNOWLEDGED', 'operator', { ...context, at }, { lifecycle: opportunity.lifecycle });
      return this.getById(id)!;
    }));
  }

  /** Keeps these tenders out of the Inbox until a run sees them again. */
  hideFromInbox(ids: string[], at = new Date().toISOString()): void {
    const update = this.db.prepare('UPDATE opportunities SET inbox_hidden_at = ? WHERE id = ? AND workspace_id = ?');
    for (const id of ids) update.run(at, id, this.workspaceId);
  }

  /** Moves open tenders whose closing time has passed to EXPIRED. Returns how many moved. */
  expireOverdue(now = new Date()): number {
    const nowIso = now.toISOString();
    const placeholders = OPEN_LIFECYCLES.map(() => '?').join(', ');
    const overdue = this.db.prepare(
      `SELECT id FROM opportunities WHERE workspace_id = ? AND closing_at IS NOT NULL AND closing_at < ?
       AND lifecycle IN (${placeholders})`
    ).all(this.workspaceId, nowIso, ...OPEN_LIFECYCLES) as Array<{ id: string }>;
    return this.inTransaction(() => {
      for (const { id } of overdue) {
        const opportunity = this.require(id);
        this.db.prepare("UPDATE opportunities SET lifecycle = 'EXPIRED', updated_at = ? WHERE id = ?").run(nowIso, id);
        this.insertEvent(id, 'EXPIRED', 'automation', { at: nowIso }, { from: opportunity.lifecycle, closingAt: opportunity.closing_at });
      }
      return overdue.length;
    });
  }

  /**
   * Detaches a run that is being deleted. Tenders the operator acted on keep
   * their record and history; tenders only automation touched, and seen by
   * no other run, are removed with it. Call before deleting the job's rows.
   */
  releaseJob(jobId: string): void {
    this.inTransaction(() => {
      const linked = this.db.prepare(
        'SELECT DISTINCT opportunity_id AS id FROM tenders WHERE job_id = ? AND opportunity_id IS NOT NULL'
      ).all(jobId) as Array<{ id: string }>;
      this.db.prepare('UPDATE tenders SET opportunity_id = NULL WHERE job_id = ?').run(jobId);
      for (const { id } of linked) {
        const opportunity = this.getById(id);
        if (!opportunity) continue;
        const remaining = this.db.prepare(
          'SELECT id FROM tenders WHERE opportunity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
        ).get(id) as { id: string } | undefined;
        const operatorTouched = this.db.prepare(
          `SELECT 1 FROM opportunity_events WHERE opportunity_id = ? AND actor = 'operator' LIMIT 1`
        ).get(id);
        if (!remaining && !operatorTouched) {
          this.db.prepare('DELETE FROM opportunity_links WHERE from_opportunity_id = ? OR to_opportunity_id = ?').run(id, id);
          this.db.prepare('DELETE FROM opportunity_events WHERE opportunity_id = ?').run(id);
          this.db.prepare('DELETE FROM opportunities WHERE id = ?').run(id);
        } else {
          this.db.prepare('UPDATE opportunities SET latest_sighting_id = ? WHERE id = ?').run(remaining?.id ?? null, id);
        }
      }
    });
  }

  private transition(
    id: string,
    to: OpportunityLifecycle,
    kind: OpportunityEventKind,
    actor: OpportunityActor,
    context: EventContext,
    data: Record<string, unknown>
  ): OpportunityRow {
    return this.inTransaction(() => {
      const opportunity = this.require(id);
      if (opportunity.lifecycle === to) return opportunity;
      assertTransition(opportunity.lifecycle, to);
      const at = context.at ?? new Date().toISOString();
      this.db.prepare('UPDATE opportunities SET lifecycle = ?, updated_at = ? WHERE id = ?').run(to, at, id);
      this.insertEvent(id, kind, actor, context, { from: opportunity.lifecycle, ...data });
      return this.getById(id)!;
    });
  }

  private insertEvent(
    opportunityId: string,
    kind: OpportunityEventKind,
    actor: OpportunityActor,
    context: EventContext,
    data: Record<string, unknown>
  ): void {
    this.db.prepare(
      `INSERT INTO opportunity_events (id, workspace_id, opportunity_id, kind, actor, actor_id, job_id, note, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
    ).run(randomUUID(), this.workspaceId, opportunityId, kind, actor, context.jobId ?? null,
      cleanNote(context.note), JSON.stringify(data), context.at ?? new Date().toISOString());
  }

  private require(id: string): OpportunityRow {
    const opportunity = this.getById(id);
    if (!opportunity) throw new Error(`Tender ${id} not found.`);
    return opportunity;
  }

  // node:sqlite has no nested transactions; join the caller's if one is open.
  private inTransaction<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn();
    let result!: T;
    withTransaction(this.db, () => { result = fn(); });
    return result;
  }
}
