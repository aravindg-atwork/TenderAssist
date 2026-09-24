import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../src/persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { ClassificationRepository } from '../../src/persistence/repositories/classificationRepository.js';
import { TenderWorkflowRepository } from '../../src/persistence/repositories/tenderWorkflowRepository.js';
import { JobOutputRepository } from '../../src/persistence/repositories/jobOutputRepository.js';
import { JobStateMachine } from '../../src/state/jobStateMachine.js';
import { AuthStateMachine } from '../../src/state/authStateMachine.js';
import { PORTAL_SESSION_EXPIRED_REASON, runPostProcessing } from '../../src/orchestration/postProcessingRunner.js';

const PORTAL_URL = 'https://tntenders.gov.in/nicgep/app';
const EXPIRED_URL = `${PORTAL_URL}?page=NoAuthorizationPage&service=page`;

type FakeResponse = { url: string; contentType: string; body: string };
const pdf = (url: string): FakeResponse => ({ url, contentType: 'application/pdf', body: '%PDF-1.4 tender' });
const expiredPage = (): FakeResponse => ({ url: EXPIRED_URL, contentType: 'text/html', body: '<html>Unauthorized access</html>' });

function fakePage(respond: (url: string) => FakeResponse, requested: string[]): Page {
  return {
    context: () => ({
      request: {
        get: async (url: string) => {
          requested.push(url);
          const response = respond(url);
          return {
            ok: () => true,
            status: () => 200,
            url: () => response.url,
            body: async () => Buffer.from(response.body),
            headers: () => ({ 'content-type': response.contentType }),
          };
        },
      },
    }),
  } as unknown as Page;
}

function setup() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
  const jobs = new JobRepository(db);
  const sessions = new AuthSessionRepository(db);
  const transitions = new StateTransitionRepository(db);
  const jobMachine = new JobStateMachine(db, jobs, transitions);
  const authMachine = new AuthStateMachine(db, sessions, transitions);
  const tenders = new TenderRepository(db);
  const classifications = new ClassificationRepository(db);
  const workflow = new TenderWorkflowRepository(db);
  const outputs = new JobOutputRepository(db);

  const job = jobs.create();
  for (const state of ['AUTH_REQUIRED', 'AUTH_PENDING', 'AUTHENTICATED', 'SEARCHING', 'CLASSIFYING', 'SHORTLISTED'] as const) {
    jobMachine.transition(job.id, state);
  }
  const session = sessions.create(job.id);
  authMachine.transition(session.id, 'AUTH_PENDING');
  authMachine.transition(session.id, 'AUTHENTICATED');

  const tender = tenders.upsert({
    jobId: job.id, tenderRef: 'REF-1', tenderPortalId: '2026_ONE', title: 'Citizen portal',
    organisationChain: 'Dept A', publishedDate: '2026-09-23', closingDate: null, openingDate: null,
    productCategory: 'Information Technology', valueInRupees: 'NA',
  });
  tenders.updateDetail(tender.id, {
    organisationChain: 'Dept A', productCategory: 'Information Technology', tenderCategory: 'Services',
    publishedDate: '2026-09-23', detailText: 'Scope of work.',
    documentLinks: [
      { url: `${PORTAL_URL}/download/first.pdf`, fileName: 'first.pdf' },
      { url: `${PORTAL_URL}/download/second.pdf`, fileName: 'second.pdf' },
    ],
  });

  const outputRoot = mkdtempSync(join(tmpdir(), 'tenderassist-expiry-test-'));
  const deps = { jobs, sessions, jobMachine, tenders, classifications, workflow, outputs, signal: undefined };
  const run = (page: Page, authSessionId: string) => runPostProcessing(
    deps, page, job.id, authSessionId,
    { searchDate: '2026-09-23', productCategories: ['Information Technology'], keywords: [], excludedKeywords: [] },
    outputRoot, () => {}, '', PORTAL_URL, [tender.id]
  );
  return { db, jobs, sessions, jobMachine, authMachine, workflow, job, session, tender, outputRoot, run };
}

describe('runPostProcessing when the portal session expires', () => {
  it('stops at the expired response, keeps finished files, and never saves the portal page as a document', async () => {
    const t = setup();
    const requested: string[] = [];
    const result = await t.run(fakePage((url) => (url.endsWith('second.pdf') ? expiredPage() : pdf(url)), requested), t.session.id);

    expect(result.outcome).toBeUndefined();
    expect(result.abortReason).toBe(PORTAL_SESSION_EXPIRED_REASON);
    expect(result.jobState).toBe('SESSION_EXPIRED');
    const documents = t.workflow.listDocuments(t.tender.id);
    expect(documents.find((d) => d.file_name === 'first.pdf')?.state).toBe('DOWNLOADED');
    expect(documents.find((d) => d.file_name === 'second.pdf')?.state).not.toBe('DOWNLOADED');
    expect(documents.find((d) => d.file_name === 'second.pdf')?.state).not.toBe('FAILED');
    const files = readdirSync(t.outputRoot, { recursive: true }) as string[];
    expect(files.some((file) => file.includes('second'))).toBe(false);
  });

  it('resumes after a fresh sign-in without downloading finished documents again', async () => {
    const t = setup();
    await t.run(fakePage((url) => (url.endsWith('second.pdf') ? expiredPage() : pdf(url)), []), t.session.id);

    t.jobMachine.transition(t.job.id, 'AUTH_REQUIRED');
    t.jobMachine.transition(t.job.id, 'AUTH_PENDING');
    t.jobMachine.transition(t.job.id, 'AUTHENTICATED');
    const fresh = t.sessions.create(t.job.id);
    const requested: string[] = [];
    const result = await t.run(fakePage(pdf, requested), fresh.id);

    expect(result.outcome).toBe('SUCCESS');
    expect(t.jobs.getById(t.job.id)?.state).toBe('COMPLETE');
    expect(requested).toEqual([`${PORTAL_URL}/download/second.pdf`]);
    expect(t.workflow.listDocuments(t.tender.id).every((d) => d.state === 'DOWNLOADED')).toBe(true);
  });

  it('asks for sign-in before any download when the session already expired during selection', async () => {
    const t = setup();
    t.authMachine.transition(t.session.id, 'SESSION_EXPIRED', 'portal timeout');
    const requested: string[] = [];
    const result = await t.run(fakePage(pdf, requested), t.session.id);

    expect(result.jobState).toBe('SESSION_EXPIRED');
    expect(result.abortReason).toBe(PORTAL_SESSION_EXPIRED_REASON);
    expect(requested).toEqual([]);
  });
});

describe('runPostProcessing when the session-loss watcher got there first', () => {
  it('leaves the job waiting for sign-in instead of failing', async () => {
    const t = setup();
    const page = fakePage((url) => {
      if (url.endsWith('second.pdf')) {
        // The watcher reacts to the portal redirect before the download returns.
        if (t.jobs.getById(t.job.id)?.state === 'ACQUIRING_DOCUMENTS') t.jobMachine.transition(t.job.id, 'AUTH_REQUIRED', 'watcher');
        return expiredPage();
      }
      return pdf(url);
    }, []);
    const result = await t.run(page, t.session.id);
    expect(result.abortReason).toBe(PORTAL_SESSION_EXPIRED_REASON);
    expect(result.outcome).toBeUndefined();
    expect(result.jobState).toBe('AUTH_REQUIRED');
  });
});
