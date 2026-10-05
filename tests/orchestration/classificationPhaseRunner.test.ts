import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../src/persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { ClassificationRepository } from '../../src/persistence/repositories/classificationRepository.js';
import { JobStateMachine } from '../../src/state/jobStateMachine.js';
import { AuthStateMachine } from '../../src/state/authStateMachine.js';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { runClassificationPhase } from '../../src/orchestration/classificationPhaseRunner.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

const MY_TENDERS_PAGE_1_HTML = `<html><body>
  <h1>My Tenders</h1>
  <table>
    <tr><td>Tender ID</td><td>Tender Title</td><td>Favorite</td></tr>
    <tr><td>2026_OTHER_1</td><td>Unrelated tender</td><td>Already reviewed</td></tr>
  </table>
  <a href="/my?page=2" title="Next page">Next</a>
</body></html>`;

const MY_TENDERS_PAGE_2_HTML = `<html><body>
  <h1>My Tenders</h1>
  <table>
    <tr><td>Tender ID</td><td>Tender Title</td><td>Favorite</td></tr>
    <tr>
      <td>2026_TEST_1</td><td>Development of Citizen Services Portal</td>
      <td><a href="/detail" target="_blank"><img title="View Tender Information"></a></td>
    </tr>
  </table>
</body></html>`;

const DETAIL_HTML = `<html><head><meta charset="utf-8"></head><body>
  <h1>Development of Citizen Services Portal</h1>
  <table>
    <tr><td>Tender ID</td><td>2026_TEST_1</td></tr>
    <tr><td>Tender Reference Number</td><td>REF/IT/1</td></tr>
    <tr><td>Tender Category</td><td>Services</td></tr>
    <tr><td>Product Category</td><td>Information Technology</td></tr>
    <tr><td>Published Date</td><td>21-Sep-2026 10:00 AM</td></tr>
    <tr><td>Organisation Chain</td><td>Department of Information Technology</td></tr>
    <tr><td>Tender Fee in ₹</td><td>1,180</td><td>EMD Amount in ₹</td><td>25,000</td></tr>
  </table>
  <p>The primary deliverable is software development of a web application for citizen services.</p>
</body></html>`;

describe.skipIf(!CHROME_PATH)('runClassificationPhase', { timeout: 30_000 }, () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let sessions: AuthSessionRepository;
  let tenders: TenderRepository;
  let classifications: ClassificationRepository;
  let jobMachine: JobStateMachine;
  let jobId: string;
  let authSessionId: string;
  let tenderId: string;
  let server: Server;
  let serverPort: number;
  let userDataDir: string;
  let chromeProc: ReturnType<typeof launchChrome>;
  let cdpPort: number;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    jobs = new JobRepository(db);
    sessions = new AuthSessionRepository(db);
    tenders = new TenderRepository(db);
    classifications = new ClassificationRepository(db);
    const transitions = new StateTransitionRepository(db);
    jobMachine = new JobStateMachine(db, jobs, transitions);
    const authMachine = new AuthStateMachine(db, sessions, transitions);

    const job = jobs.create();
    jobId = job.id;
    for (const state of ['AUTH_REQUIRED', 'AUTH_PENDING', 'AUTHENTICATED', 'SEARCHING', 'CLASSIFYING'] as const) {
      jobMachine.transition(jobId, state, 'test setup');
    }
    const session = sessions.create(jobId);
    authSessionId = session.id;
    authMachine.transition(authSessionId, 'AUTH_PENDING', 'test setup');
    authMachine.transition(authSessionId, 'AUTHENTICATED', 'test setup');

    const tender = tenders.upsert({
      jobId,
      tenderRef: 'REF/IT/1',
      tenderPortalId: '2026_TEST_1',
      title: 'Development of Citizen Services Portal',
      organisationChain: null,
      publishedDate: null,
      closingDate: null,
      openingDate: null,
      productCategory: 'Information Technology',
      valueInRupees: 'NA',
    });
    tenderId = tender.id;
    tenders.markFavorited(tender.id, new Date().toISOString());

    server = http.createServer((req, res) => {
      if (req.url === '/my') res.end(MY_TENDERS_PAGE_1_HTML);
      else if (req.url === '/my?page=2') res.end(MY_TENDERS_PAGE_2_HTML);
      else if (req.url === '/detail') res.end(DETAIL_HTML);
      else res.end('<html><body><a href="/my">My Tenders</a></body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as { port: number }).port;

    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-classification-test-'));
    cdpPort = 9222 + Math.floor(Math.random() * 5000);
    chromeProc = launchChrome({ userDataDir, cdpPort, startUrl: `http://127.0.0.1:${serverPort}/` });
    await waitForCdpReady(cdpPort, 10_000);
  }, 30_000);

  afterEach(async () => {
    if (chromeProc.pid) {
      try {
        process.kill(chromeProc.pid);
      } catch {
        // already exited
      }
    }
    await removeDirWithRetry(userDataDir);
    server.close();
  });

  it('reviews only the current-job favorite popup, records four gates, and reaches SHORTLISTED', async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/`);

    const result = await runClassificationPhase(
      { jobs, sessions, jobMachine, tenders, classifications },
      page,
      jobId,
      authSessionId,
      {
        searchDate: '2026-09-21',
        productCategories: ['Information Technology'],
        keywords: ['software development', 'web application'],
        excludedKeywords: ['annual maintenance contract', 'computer hardware'],
      },
      () => {}
    );

    expect(result.outcome).toBe('SUCCESS');
    expect(result.phase).toBe('CLASSIFICATION');
    expect(jobs.getById(jobId)?.state).toBe('SHORTLISTED');
    expect(classifications.listForTender(tenderId)).toHaveLength(4);
    expect(classifications.getFinalForTender(tenderId)).toBe('KEEP');
    const reviewed = tenders.findByJobAndRef(jobId, 'REF/IT/1')!;
    expect(reviewed.detail_product_category).toBe('Information Technology');
    expect(reviewed.published_date).toBe('2026-09-21T10:00:00+05:30');
    expect(reviewed.detail_reviewed_at).not.toBeNull();
    // A label | value | label | value row is two fields.
    expect(reviewed.detail_text).toContain('Tender Fee in ₹: 1,180\nEMD Amount in ₹: 25,000');
  });

  it('saves a kept tender documents while its details pop-up is still open', async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/`);
    const calls: Array<{ tenderId: string; url: string; open: boolean; text: string }> = [];
    const config = {
      searchDate: '2026-09-21',
      productCategories: ['Information Technology'],
      keywords: ['software development'],
      excludedKeywords: [],
    };

    await runClassificationPhase(
      {
        jobs, sessions, jobMachine, tenders, classifications,
        saveDocuments: async (tender, detailPage) => {
          calls.push({ tenderId: tender.id, url: detailPage.url(), open: !detailPage.isClosed(), text: await detailPage.innerText('h1') });
        },
      },
      page, jobId, authSessionId, config, () => {}
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tenderId, open: true, text: 'Development of Citizen Services Portal' });
    expect(calls[0].url).toContain('/detail');
  });

  it('does not save documents for a tender that does not match the intent', async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/`);
    let saved = 0;

    await runClassificationPhase(
      { jobs, sessions, jobMachine, tenders, classifications, saveDocuments: async () => { saved += 1; } },
      page, jobId, authSessionId,
      { searchDate: '2026-09-21', productCategories: ['Information Technology'], keywords: ['documentary film'], excludedKeywords: [] },
      () => {}
    );

    expect(classifications.getFinalForTender(tenderId)).toBe('REJECT');
    expect(saved).toBe(0);
  });
});
