// tests/orchestration/searchPhaseRunner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { runMigrations } from '../../src/persistence/migrate.js';
import { JobRepository } from '../../src/persistence/repositories/jobRepository.js';
import { AuthSessionRepository } from '../../src/persistence/repositories/authSessionRepository.js';
import { StateTransitionRepository } from '../../src/persistence/repositories/stateTransitionRepository.js';
import { SearchRepository } from '../../src/persistence/repositories/searchRepository.js';
import { TenderRepository } from '../../src/persistence/repositories/tenderRepository.js';
import { JobStateMachine } from '../../src/state/jobStateMachine.js';
import { AuthStateMachine } from '../../src/state/authStateMachine.js';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { runSearchPhase } from '../../src/orchestration/searchPhaseRunner.js';
import type { AuthJobUpdate } from '../../src/orchestration/authJobRunner.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

function resultsHtml(category: string): string {
  const isTarget = category === 'Information Technology';
  const row = isTarget
    ? `<tr>
        <td>1.</td><td>tender-${category}</td><td>Title for ${category}</td>
        <td>ref-${category}</td><td>${category}</td><td>NA</td>
        <td><input type="checkbox" name="Checkbox" id="Checkbox"></td>
      </tr>`
    : '';
  return `<html><body>
    <a href="/">Search Active Tenders</a>
    <form id="activeTenders" action="/favorited" method="post">
      <table>
        <tr><td>S.No</td><td>Tender ID</td><td>Tender Title</td><td>Tender Reference Number</td><td>Product Category</td><td>Value in Rs</td><td>Favorite</td></tr>
        ${row}
      </table>
      <script>
        function checkConformSaveDocuments(f1, cname) {
          var f = document.getElementById(f1);
          var countf = 0, counti = 0;
          for (var i = 0; i < f.elements.length; i++) {
            if (f.elements[i].type === 'checkbox') { counti++; if (f.elements[i].checked) countf++; }
          }
          if (countf <= 0) { alert('none selected'); return false; }
          return true;
        }
      </script>
      <input type="submit" id="save" value="Set Open Tender as Favorite" onclick="return checkConformSaveDocuments('activeTenders','tender');">
    </form>
  </body></html>`;
}

const SEARCH_FORM_HTML = `<html><body>
  <a href="/">Search Active Tenders</a>
  <select id="ProductCategory">
    <option value="">-Select-</option>
    <option>Computer- S/W</option>
    <option>Information Technology</option>
    <option>Info. Tech. Services</option>
    <option>Documentary film,Video film</option>
    <option>Miscellaneous Goods</option>
    <option>Miscellaneous Services</option>
    <option>Miscellaneous Works</option>
  </select>
  <select id="dateCriteria"><option value="0">-Select-</option><option value="1">Published Date</option></select>
  <input type="text" name="fromDate" id="fromDate" readonly value="">
  <input type="text" name="toDate" id="toDate" readonly value="">
  <input type="submit" id="submit" value="Search" onclick="document.location.href='/results?category=' + encodeURIComponent(document.getElementById('ProductCategory').value)">
</body></html>`;

describe.skipIf(!CHROME_PATH)('runSearchPhase', { timeout: 30_000 }, () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let sessions: AuthSessionRepository;
  let jobMachine: JobStateMachine;
  let authMachine: AuthStateMachine;
  let searches: SearchRepository;
  let tenders: TenderRepository;
  let jobId: string;
  let authSessionId: string;
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
    const transitions = new StateTransitionRepository(db);
    jobMachine = new JobStateMachine(db, jobs, transitions);
    authMachine = new AuthStateMachine(db, sessions, transitions);
    searches = new SearchRepository(db);
    tenders = new TenderRepository(db);

    const job = jobs.create();
    jobId = job.id;
    jobMachine.transition(jobId, 'AUTH_REQUIRED', 'test setup');
    jobMachine.transition(jobId, 'AUTH_PENDING', 'test setup');
    jobMachine.transition(jobId, 'AUTHENTICATED', 'test setup');
    const session = sessions.create(jobId);
    authSessionId = session.id;
    authMachine.transition(authSessionId, 'AUTH_PENDING', 'test setup');
    authMachine.transition(authSessionId, 'AUTHENTICATED', 'test setup');

    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/results')) {
        const url = new URL(req.url, 'http://localhost');
        res.end(resultsHtml(decodeURIComponent(url.searchParams.get('category') ?? '')));
      } else if (req.url?.startsWith('/favorited')) {
        res.end('<html><body>Favorited. <a href="/">Search Active Tenders</a></body></html>');
      } else {
        res.end(SEARCH_FORM_HTML);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as { port: number }).port;

    userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-searchphase-test-'));
    cdpPort = 9222 + Math.floor(Math.random() * 5000);
    chromeProc = launchChrome({ userDataDir, cdpPort, startUrl: `http://127.0.0.1:${serverPort}/` });
    await waitForCdpReady(cdpPort, 10000);
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

  it('runs all 7 searches, favorites the one matching category, and lands the job in CLASSIFYING', async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = browser.contexts()[0].pages()[0];
    await page.goto(`http://127.0.0.1:${serverPort}/`);

    const updates: AuthJobUpdate[] = [];
    const result = await runSearchPhase(
      { jobs, sessions, jobMachine, searches, tenders },
      page,
      jobId,
      authSessionId,
      (u) => updates.push(u)
    );

    expect(result.outcome).toBe('SUCCESS');
    expect(result.phase).toBe('SEARCH');
    expect(result.jobState).toBe('CLASSIFYING');
    expect(jobs.getById(jobId)!.state).toBe('CLASSIFYING');

    const allSearches = searches.listForJob(jobId);
    expect(allSearches).toHaveLength(7);
    expect(allSearches.every((s) => s.state === 'COMPLETE')).toBe(true);

    const allTenders = tenders.listForJob(jobId);
    expect(allTenders).toHaveLength(1);
    expect(allTenders[0].tender_ref).toBe('ref-Information Technology');
    expect(allTenders[0].favorited).toBe(1);
    expect(allTenders[0].favorited_at).not.toBeNull();

    expect(updates.at(-1)?.outcome).toBe('SUCCESS');
  });
});
