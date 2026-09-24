import type { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';
import type { OpportunityEventRow } from '../persistence/repositories/opportunityRepository.js';
import { describeTimeline } from './timeline.js';

// One chronological record of what automation and the operator did: tender
// decisions and changes, run and sign-in states, searches, and document
// downloads. Read-only; secrets are never stored in these tables.

export type AuditArea = 'Tender' | 'Run' | 'Sign-in' | 'Search' | 'Document';

export interface AuditEntry {
  /** UTC ISO timestamp. */
  at: string;
  area: AuditArea;
  who: 'Automation' | 'Operator';
  tenderId: string | null;
  title: string | null;
  what: string;
  detail: string | null;
  jobId: string | null;
}

function tenderEntries(db: DatabaseSync, workspaceId: string): AuditEntry[] {
  const rows = db.prepare(
    `SELECT e.*, COALESCE(o.tender_portal_id, o.tender_ref) AS tender_key, o.title AS tender_title
     FROM opportunity_events e JOIN opportunities o ON o.id = e.opportunity_id
     WHERE e.workspace_id = ? ORDER BY e.created_at ASC, e.rowid ASC`
  ).all(workspaceId) as unknown as Array<OpportunityEventRow & { tender_key: string; tender_title: string }>;
  const described = describeTimeline(rows);
  return rows.map((row, index) => ({
    at: row.created_at,
    area: 'Tender',
    who: row.actor === 'operator' ? 'Operator' : 'Automation',
    tenderId: row.tender_key,
    title: row.tender_title,
    what: described[index].title,
    detail: described[index].detail,
    jobId: row.job_id,
  }));
}

function stateEntries(db: DatabaseSync): AuditEntry[] {
  const rows = db.prepare(
    `SELECT t.entity_type, t.entity_id, t.from_state, t.to_state, t.reason, t.occurred_at, a.job_id AS session_job_id
     FROM state_transitions t LEFT JOIN auth_sessions a ON t.entity_type = 'AUTH_SESSION' AND a.id = t.entity_id
     WHERE t.entity_type IN ('JOB', 'AUTH_SESSION') ORDER BY t.occurred_at ASC, t.rowid ASC`
  ).all() as Array<{ entity_type: string; entity_id: string; from_state: string | null; to_state: string; reason: string | null; occurred_at: string; session_job_id: string | null }>;
  return rows.map((row) => {
    const isRun = row.entity_type === 'JOB';
    return {
      at: row.occurred_at,
      area: isRun ? 'Run' : 'Sign-in',
      who: 'Automation',
      tenderId: null,
      title: null,
      what: `${isRun ? 'Run' : 'Portal sign-in'}: ${row.from_state ? `${row.from_state} → ` : ''}${row.to_state}`,
      detail: row.reason,
      jobId: isRun ? row.entity_id : row.session_job_id,
    };
  });
}

function searchEntries(db: DatabaseSync): AuditEntry[] {
  const rows = db.prepare(
    `SELECT job_id, product_category, state, result_count, current_page, updated_at FROM searches ORDER BY updated_at ASC, rowid ASC`
  ).all() as Array<{ job_id: string; product_category: string; state: string; result_count: number | null; current_page: number; updated_at: string }>;
  return rows.map((row) => ({
    at: row.updated_at,
    area: 'Search',
    who: 'Automation',
    tenderId: null,
    title: null,
    what: `Searched “${row.product_category}”: ${row.state.toLowerCase()}`,
    detail: row.result_count === null ? null : `${row.result_count} results, ${row.current_page} page${row.current_page === 1 ? '' : 's'} read`,
    jobId: row.job_id,
  }));
}

function documentEntries(db: DatabaseSync): AuditEntry[] {
  const rows = db.prepare(
    `SELECT d.file_name, d.state, d.checksum_sha256, d.error, d.source_url, d.downloaded_at, d.updated_at,
            t.job_id, COALESCE(t.tender_portal_id, t.tender_ref) AS tender_key, t.title
     FROM tender_documents d JOIN tenders t ON t.id = d.tender_id
     WHERE d.state IN ('DOWNLOADED', 'FAILED') ORDER BY COALESCE(d.downloaded_at, d.updated_at) ASC, d.rowid ASC`
  ).all() as Array<{ file_name: string; state: string; checksum_sha256: string | null; error: string | null; source_url: string; downloaded_at: string | null; updated_at: string; job_id: string; tender_key: string; title: string }>;
  return rows.map((row) => {
    const downloaded = row.state === 'DOWNLOADED';
    return {
      at: row.downloaded_at ?? row.updated_at,
      area: 'Document',
      who: 'Automation',
      tenderId: row.tender_key,
      title: row.title,
      what: `${downloaded ? 'Downloaded' : 'Download failed'}: ${row.file_name}`,
      detail: downloaded ? (row.checksum_sha256 ? `SHA-256 ${row.checksum_sha256}` : null) : row.error,
      jobId: row.job_id,
    };
  });
}

/** Everything recorded, oldest first. */
export function collectAuditHistory(db: DatabaseSync, workspaceId = 'local'): AuditEntry[] {
  return [...tenderEntries(db, workspaceId), ...stateEntries(db), ...searchEntries(db), ...documentEntries(db)]
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Local wall-clock time as an Excel date, so the sheet shows the time the operator saw. */
function localExcelDate(iso: string): Date {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
}

export async function writeAuditWorkbook(entries: AuditEntry[], filePath: string, exportedAt = new Date()): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TenderAssist';
  workbook.created = exportedAt;
  const sheet = workbook.addWorksheet('Audit history', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'When (local time)', key: 'when', width: 20, style: { numFmt: 'dd-mmm-yyyy hh:mm:ss' } },
    { header: 'Area', key: 'area', width: 11 },
    { header: 'Who', key: 'who', width: 12 },
    { header: 'Tender ID', key: 'tenderId', width: 24 },
    { header: 'What happened', key: 'what', width: 44 },
    { header: 'Detail', key: 'detail', width: 60 },
    { header: 'Tender title', key: 'title', width: 52 },
    { header: 'Run', key: 'jobId', width: 38 },
    { header: 'UTC timestamp', key: 'at', width: 26 },
  ];
  for (const entry of entries) {
    sheet.addRow({ ...entry, when: localExcelDate(entry.at) });
  }
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  for (const key of ['what', 'detail', 'title']) sheet.getColumn(key).alignment = { wrapText: true, vertical: 'top' };
  await workbook.xlsx.writeFile(filePath);
}
