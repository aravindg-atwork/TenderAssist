import type { Page } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { JobRepository } from '../persistence/repositories/jobRepository.js';
import type { AuthSessionRepository } from '../persistence/repositories/authSessionRepository.js';
import type { TenderRepository, TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { ClassificationRepository } from '../persistence/repositories/classificationRepository.js';
import type { TenderWorkflowRepository } from '../persistence/repositories/tenderWorkflowRepository.js';
import type { JobOutputRepository } from '../persistence/repositories/jobOutputRepository.js';
import type { JobStateMachine } from '../state/jobStateMachine.js';
import { extractTenderRequirements } from '../extraction/requirementExtractor.js';
import { publishJobWorkbook, tenderDocumentsDirectory } from '../publishing/jobPublisher.js';
import { DEFAULT_OUTPUT_STRUCTURE, type OutputStructureSettings } from '../publishing/outputStructure.js';
import type { RunConfiguration } from '../config/runConfiguration.js';
import type { AuthJobUpdate } from './authJobRunner.js';
import { isCancellationRequested, markJobCancelled, throwIfCancellationRequested, USER_CANCELLED_REASON } from './jobCancellation.js';
import { isSessionExpiredPage } from '../browser/sessionExpiredDetector.js';

const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export const PORTAL_SESSION_EXPIRED_REASON = 'The portal signed you out before every selected document was downloaded.';

class PortalSessionExpiredError extends Error {}

/** A document request that lands on the portal's sign-in or "unauthorized" page instead of a file. */
function isExpiredSessionResponse(finalUrl: string, contentType: string | undefined, body: Buffer): boolean {
  if (isSessionExpiredPage(finalUrl, '')) return true;
  if (!/text\/html/i.test(contentType ?? '')) return false;
  const text = body.subarray(0, 200_000).toString('utf8');
  return isSessionExpiredPage(finalUrl, text) || /page=(?:Login|NoAuthorizationPage|CommonErrorPage)/i.test(text);
}

export interface PostProcessingDeps {
  jobs: JobRepository;
  sessions: AuthSessionRepository;
  jobMachine: JobStateMachine;
  tenders: TenderRepository;
  classifications: ClassificationRepository;
  workflow: TenderWorkflowRepository;
  outputs: JobOutputRepository;
  signal?: AbortSignal;
}

function safeFileName(value: string, index: number, url: string): string {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  const urlExt = (() => { try { return extname(new URL(url).pathname); } catch { return ''; } })();
  const base = clean || `document-${index + 1}`;
  return extname(base) || !urlExt ? base : `${base}${urlExt}`;
}

function fileNameForResponse(baseName: string, contentType: string | undefined): string {
  if (extname(baseName)) return baseName;
  const extensions: Array<[RegExp, string]> = [
    [/application\/pdf/i, '.pdf'], [/application\/zip/i, '.zip'],
    [/wordprocessingml|msword/i, '.docx'], [/spreadsheetml|excel/i, '.xlsx'],
    [/text\/plain/i, '.txt'],
  ];
  return `${baseName}${extensions.find(([pattern]) => pattern.test(contentType ?? ''))?.[1] ?? '.bin'}`;
}

function trustedPortalUrl(raw: string, portalUrl: string): boolean {
  try {
    const url = new URL(raw);
    const portal = new URL(portalUrl);
    const portalRoot = portal.pathname.replace(/\/app\/?$/i, '').toLocaleLowerCase();
    const expectedHost = portal.hostname.toLocaleLowerCase().replace(/^www\./, '');
    return url.protocol === 'https:' && url.hostname.toLocaleLowerCase().replace(/^www\./, '') === expectedHost && url.pathname.toLocaleLowerCase().startsWith(`${portalRoot}/`);
  } catch { return false; }
}

function linksFor(tender: TenderRow): Array<{ url: string; fileName: string }> {
  try {
    const parsed = JSON.parse(tender.document_links_json) as Array<{ url?: unknown; fileName?: unknown }>;
    return parsed.filter((link): link is { url: string; fileName: string } => typeof link.url === 'string' && typeof link.fileName === 'string');
  } catch { return []; }
}

export async function runPostProcessing(
  deps: PostProcessingDeps,
  /** Undefined when no portal is signed in: saved work continues, and the first download needed asks for sign-in. */
  page: Page | undefined,
  jobId: string,
  authSessionId: string,
  config: RunConfiguration,
  outputRoot: string,
  onUpdate: (update: AuthJobUpdate) => void,
  portalUrl = 'https://tntenders.gov.in/nicgep/app',
  selectedTenderIds?: string[],
  outputStructure: OutputStructureSettings = DEFAULT_OUTPUT_STRUCTURE
): Promise<AuthJobUpdate> {
  const snapshot = (phase: AuthJobUpdate['phase'], outcome?: 'SUCCESS' | 'ABORTED', abortReason?: string): AuthJobUpdate => ({
    jobId, authSessionId, jobState: deps.jobs.getById(jobId)!.state,
    authState: deps.sessions.getById(authSessionId)?.state ?? 'NOT_STARTED', phase, outcome, abortReason,
  });
  const allTenders = deps.tenders.listForJob(jobId);
  // selectedTenderIds carries the user's explicit tick-box choice from the
  // review panel -- undefined only for callers that haven't been updated to
  // pass a selection (falls back to every automatic/manual KEEP, the old
  // fully-automatic behaviour).
  const approved = selectedTenderIds
    ? allTenders.filter((tender) => selectedTenderIds.includes(tender.id))
    : allTenders.filter((tender) => {
        const review = deps.workflow.getReview(tender.id);
        return review?.decision === 'KEEP' || (!review && deps.classifications.getFinalForTender(tender.id) === 'KEEP');
      });

  try {
    throwIfCancellationRequested(deps.signal);
    // Files go in the published date's day folder, so a range of dates
    // lands in one folder per date. A retried job keeps the folder and names
    // it was first given, even if the templates changed since.
    const plan = deps.outputs.getOrCreatePlan(jobId, outputRoot, config.searchDate, outputStructure);
    const { outputDate, structure, jobDirectory } = plan;
    const authState = deps.sessions.getById(authSessionId)?.state;
    const pending = approved.some((tender) => linksFor(tender).some((link) => deps.workflow.findDocument(tender.id, link.url)?.state !== 'DOWNLOADED'));
    if (pending && (!page || authState === 'SESSION_EXPIRED' || authState === 'TAB_LOST')) {
      throw new PortalSessionExpiredError(PORTAL_SESSION_EXPIRED_REASON);
    }
    deps.jobMachine.transition(jobId, 'ACQUIRING_DOCUMENTS', 'approved tender document acquisition started');
    onUpdate(snapshot('ACQUISITION'));
    for (const tender of approved) {
      throwIfCancellationRequested(deps.signal);
      const folder = tenderDocumentsDirectory(jobDirectory, tender, deps.outputs.serialNumberFor(plan, tender.id), structure, outputDate);
      mkdirSync(folder, { recursive: true });
      const links = linksFor(tender);
      for (let index = 0; index < links.length; index += 1) {
        throwIfCancellationRequested(deps.signal);
        const link = links[index];
        const proposedFileName = safeFileName(link.fileName, index, link.url);
        const document = deps.workflow.upsertDocument(tender.id, link.url, proposedFileName);
        if (document.state === 'DOWNLOADED') continue;
        // A crashed or signed-out portal cannot download; sign in again rather than fail every file.
        const sessionState = deps.sessions.getById(authSessionId)?.state;
        if (sessionState === 'TAB_LOST' || sessionState === 'SESSION_EXPIRED') throw new PortalSessionExpiredError(PORTAL_SESSION_EXPIRED_REASON);
        try {
          if (!trustedPortalUrl(link.url, portalUrl)) throw new Error('Document URL is outside the selected portal HTTPS path.');
          if (!page) throw new PortalSessionExpiredError(PORTAL_SESSION_EXPIRED_REASON);
          const response = await page.context().request.get(link.url, { timeout: 30_000 });
          throwIfCancellationRequested(deps.signal);
          if (!response.ok()) throw new Error(`Portal returned HTTP ${response.status()}.`);
          const body = await response.body();
          if (isExpiredSessionResponse(response.url(), response.headers()['content-type'], body)) {
            throw new PortalSessionExpiredError(PORTAL_SESSION_EXPIRED_REASON);
          }
          if (body.length === 0 || body.length > MAX_DOCUMENT_BYTES) throw new Error('Document is empty or exceeds the 100 MB safety limit.');
          // The portal's links answer with a web page when used away from the
          // tender page; that is not the document.
          if (/text\/html/i.test(response.headers()['content-type'] ?? '')) throw new Error('The portal returned a web page instead of the file.');
          const fileName = fileNameForResponse(proposedFileName, response.headers()['content-type']);
          const path = join(folder, fileName);
          writeFileSync(path, body);
          deps.workflow.completeDocument(document.id, fileName, path, createHash('sha256').update(body).digest('hex'));
        } catch (error) {
          if (isCancellationRequested(deps.signal) || error instanceof PortalSessionExpiredError) throw error;
          deps.workflow.failDocument(document.id, error instanceof Error ? error.message : String(error));
        }
      }
      onUpdate(snapshot('ACQUISITION'));
    }

    deps.jobMachine.transition(jobId, 'DOCUMENTS_LOCAL', 'approved tender documents stored locally');
    throwIfCancellationRequested(deps.signal);
    deps.jobMachine.transition(jobId, 'PROCESSING_DOCUMENTS', 'document processing started');
    deps.jobMachine.transition(jobId, 'EXTRACTING_REQUIREMENTS', 'requirement extraction started');
    onUpdate(snapshot('EXTRACTION'));
    for (const tender of approved) {
      throwIfCancellationRequested(deps.signal);
      const extraction = extractTenderRequirements(tender.detail_text ?? '');
      deps.workflow.saveRequirements(tender.id, extraction.requirements, extraction.confidence);
    }

    deps.jobMachine.transition(jobId, 'UPLOADING', 'publishing workbook to the local output folder');
    throwIfCancellationRequested(deps.signal);
    onUpdate(snapshot('PUBLISHING'));
    // Saved locally only. A tender goes to Drive when the operator approves it.
    await publishJobWorkbook(plan.outputRoot, outputDate, jobId, approved.map((tender) => ({
      tender,
      automaticDecision: deps.classifications.getFinalForTender(tender.id),
      manualReview: deps.workflow.getReview(tender.id),
      documents: deps.workflow.listDocuments(tender.id),
      requirements: deps.workflow.getRequirements(tender.id),
      serialNumber: deps.outputs.serialNumberFor(plan, tender.id),
    })), structure, plan.runNumber);
    throwIfCancellationRequested(deps.signal);
    deps.jobMachine.transition(jobId, 'REPORTING', 'workbook and folders created');
    deps.jobMachine.transition(jobId, 'COMPLETE', 'job output published successfully');
    const final = snapshot('PUBLISHING', 'SUCCESS');
    onUpdate(final);
    return final;
  } catch (error) {
    if (isCancellationRequested(deps.signal)) {
      markJobCancelled(deps.jobs, deps.jobMachine, jobId);
      const final = snapshot('PUBLISHING', 'ABORTED', USER_CANCELLED_REASON);
      onUpdate(final);
      return final;
    }
    if (error instanceof PortalSessionExpiredError) {
      // Not a failure: finished files and the selection are kept, and the
      // caller asks for a fresh sign-in and runs acquisition again.
      // The session-loss watcher may already have moved the job to AUTH_REQUIRED.
      if (deps.jobs.getById(jobId)?.state !== 'AUTH_REQUIRED') {
        deps.jobMachine.transition(jobId, 'SESSION_EXPIRED', 'portal session expired during document acquisition');
      }
      const saved = approved.flatMap((tender) => deps.workflow.listDocuments(tender.id)).filter((document) => document.state === 'DOWNLOADED').length;
      const paused: AuthJobUpdate = {
        ...snapshot('ACQUISITION', undefined, PORTAL_SESSION_EXPIRED_REASON),
        statusMessage: `The portal signed you out. ${saved} ${saved === 1 ? 'document is' : 'documents are'} already saved and will not be downloaded again. Sign in to continue.`,
      };
      onUpdate(paused);
      return paused;
    }
    const current = deps.jobs.getById(jobId)?.state;
    if (current && current !== 'FAILED_RETRYABLE' && current !== 'CANCELLED' && current !== 'FAILED_MANUAL') {
      deps.jobMachine.transition(jobId, 'FAILED_RETRYABLE', 'post-processing failed');
    }
    const final = snapshot('PUBLISHING', 'ABORTED', error instanceof Error ? error.message : String(error));
    onUpdate(final);
    return final;
  }
}
