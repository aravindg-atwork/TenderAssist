import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { ClassificationRepository } from '../../src/persistence/repositories/classificationRepository.js';
import { TenderWorkflowRepository } from '../../src/persistence/repositories/tenderWorkflowRepository.js';
import { OpportunityRepository } from '../../src/persistence/repositories/opportunityRepository.js';

const MIGRATIONS = join(process.cwd(), 'src', 'persistence', 'migrations');

describe('migration 010 backfill', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

  function databaseBefore010(): DatabaseSync {
    const dir = mkdtempSync(join(tmpdir(), 'tenderassist-pre010-')); dirs.push(dir);
    for (const file of readdirSync(MIGRATIONS).filter((name) => name < '010')) copyFileSync(join(MIGRATIONS, file), join(dir, file));
    const db = new DatabaseSync(':memory:');
    runMigrations(db, dir);
    return db;
  }

  it('turns per-job rows into opportunities with lifecycle and history', () => {
    const db = databaseBefore010();
    const jobs = new JobRepository(db);
    const tenders = new TenderRepository(db);
    const classifications = new ClassificationRepository(db);
    const workflow = new TenderWorkflowRepository(db);

    const seed = (jobId: string, tenderPortalId: string, createdAt: string) => {
      const tender = tenders.upsert({
        jobId, tenderRef: `REF-${tenderPortalId}`, tenderPortalId, title: `Tender ${tenderPortalId}`,
        organisationChain: null, publishedDate: null, closingDate: null, openingDate: null,
        productCategory: 'Information Technology', valueInRupees: 'NA',
      });
      db.prepare('UPDATE tenders SET created_at = ?, updated_at = ? WHERE id = ?').run(createdAt, createdAt, tender.id);
      return tender;
    };
    const gate = (tenderId: string, result: 'PASS' | 'REJECT') => classifications.saveGate({
      tenderId, gate: 'G1', result, reasonCode: 'TEST', evidence: {}, classifierVersion: 'test',
    });

    const monday = jobs.create();
    const tuesday = jobs.create();
    db.prepare(`INSERT INTO job_run_configs (job_id, search_date, product_categories_json, keywords_json, excluded_keywords_json, created_at, portal_id)
                VALUES (?, '2026-09-21', '[]', '[]', '[]', '2026-09-21', 'kerala')`).run(tuesday.id);

    // Seen twice on TN: approved and downloaded on the second sighting.
    const firstSeen = seed(monday.id, '2026_ELCO_1_1', '2026-09-21T05:00:00.000Z');
    gate(firstSeen.id, 'PASS');
    // Operator rejected a tender that only passed G1 (UNCERTAIN).
    const rejected = seed(monday.id, '2026_ELCO_2_1', '2026-09-21T05:01:00.000Z');
    gate(rejected.id, 'PASS');
    workflow.saveReview(rejected.id, 'REJECT', 'hardware only');
    // Automatic reject, never reviewed.
    const autoRejected = seed(monday.id, '2026_ELCO_3_1', '2026-09-21T05:02:00.000Z');
    gate(autoRejected.id, 'REJECT');
    // Same ID on another portal.
    seed(tuesday.id, '2026_ELCO_1_1', '2026-09-22T05:00:00.000Z');

    const tuesdayTn = jobs.create();
    const secondSeen = seed(tuesdayTn.id, '2026_ELCO_1_1', '2026-09-22T06:00:00.000Z');
    gate(secondSeen.id, 'PASS');
    const document = workflow.upsertDocument(secondSeen.id, 'https://tntenders.gov.in/nicgep/doc.pdf', 'doc.pdf');
    workflow.completeDocument(document.id, 'doc.pdf', 'C:\\out\\doc.pdf', 'abc');

    runMigrations(db, MIGRATIONS);

    const repo = new OpportunityRepository(db);
    const tn = repo.findByIdentity('tamil-nadu', '2026_ELCO_1_1')!;
    expect(tn.lifecycle).toBe('DOCUMENTS_COLLECTED');
    expect(tn.first_seen_at).toBe('2026-09-21T05:00:00.000Z');
    expect(tn.latest_sighting_id).toBe(secondSeen.id);
    expect(repo.listEvents(tn.id).map((event) => event.kind)).toEqual(['SEEN', 'SCREENED', 'SEEN', 'SCREENED', 'APPROVED', 'DOCUMENTS_COLLECTED']);

    const operatorReject = repo.findByIdentity('tamil-nadu', '2026_ELCO_2_1')!;
    expect(operatorReject).toMatchObject({ lifecycle: 'REJECTED', recommendation: 'UNCERTAIN' });
    expect(repo.listEvents(operatorReject.id).find((event) => event.kind === 'REJECTED')).toMatchObject({ actor: 'operator', note: 'hardware only' });

    const autoReject = repo.findByIdentity('tamil-nadu', '2026_ELCO_3_1')!;
    expect(autoReject).toMatchObject({ lifecycle: 'SCREENED', recommendation: 'REJECT' });
    const screening = repo.listEvents(autoReject.id).find((event) => event.kind === 'SCREENED')!;
    expect(JSON.parse(screening.data_json).gates).toEqual([{ gate: 'G1', result: 'REJECT', reasonCode: 'TEST', evidence: {} }]);
    expect(repo.findByIdentity('kerala', '2026_ELCO_1_1')).toMatchObject({ lifecycle: 'NEW' });
    expect(repo.findByIdentity('kerala', '2026_ELCO_1_1')?.inbox_hidden_at).not.toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM tenders WHERE opportunity_id IS NULL').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE reviewed_at IS NULL').get()).toEqual({ n: 0 });

    // Undecided history stays out of the Inbox; decided tenders are unaffected.
    const hidden = db.prepare('SELECT identity_key FROM opportunities WHERE inbox_hidden_at IS NOT NULL ORDER BY identity_key').all()
      .map((row) => (row as { identity_key: string }).identity_key);
    expect(hidden).toEqual(['2026_ELCO_1_1', '2026_ELCO_3_1']);
    expect(repo.listInboxRows().map((row) => row.identity_key)).toEqual([]);

    // A new run seeing a hidden tender brings it back.
    const wednesday = jobs.create();
    const kerala = repo.findByIdentity('kerala', '2026_ELCO_1_1')!;
    const seenAgain = tenders.upsert({
      jobId: wednesday.id, tenderRef: 'REF-2026_ELCO_3_1', tenderPortalId: '2026_ELCO_3_1', title: 'Tender 2026_ELCO_3_1',
      organisationChain: null, publishedDate: null, closingDate: null, openingDate: null,
      productCategory: 'Information Technology', valueInRupees: 'NA',
    });
    repo.recordSighting(seenAgain, 'tamil-nadu', { jobId: wednesday.id });
    expect(repo.findByIdentity('tamil-nadu', '2026_ELCO_3_1')?.inbox_hidden_at).toBeNull();
    expect(repo.getById(kerala.id)?.inbox_hidden_at).not.toBeNull();

    // Re-running migrations is a no-op.
    runMigrations(db, MIGRATIONS);
    expect(repo.list()).toHaveLength(4);
    expect(repo.listEvents(tn.id)).toHaveLength(6);
  });
});
