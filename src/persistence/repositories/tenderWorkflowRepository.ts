import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type ManualTenderDecision = 'KEEP' | 'REJECT';
export type DocumentState = 'PENDING' | 'DOWNLOADED' | 'FAILED';
export type ExtractionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface TenderReviewRow {
  tender_id: string;
  decision: ManualTenderDecision;
  reason: string | null;
  decided_at: string;
}

export interface TenderDocumentRow {
  id: string;
  tender_id: string;
  source_url: string;
  file_name: string;
  local_path: string | null;
  state: DocumentState;
  checksum_sha256: string | null;
  error: string | null;
  downloaded_at: string | null;
  updated_at: string;
  /** The text inside the file, when read; null before reading or when it holds none. */
  text_content?: string | null;
  /** How it was read: TEXT (the PDF's own text), OCR, MIXED, or NONE (nothing readable). */
  text_method?: 'TEXT' | 'OCR' | 'MIXED' | 'NONE' | null;
  text_pages?: number | null;
  text_ocr_pages?: number | null;
  text_read_at?: string | null;
}

export interface TenderRequirementRow {
  tender_id: string;
  data_json: string;
  confidence: ExtractionConfidence;
  extracted_at: string;
}

function cleanReason(reason?: string): string | null {
  const cleaned = reason?.trim().replace(/\s+/g, ' ') ?? '';
  return cleaned ? cleaned.slice(0, 1000) : null;
}

export class TenderWorkflowRepository {
  constructor(private db: DatabaseSync) {}

  saveReview(tenderId: string, decision: ManualTenderDecision, reason?: string): TenderReviewRow {
    const decidedAt = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO tender_reviews (tender_id, decision, reason, decided_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(tender_id) DO UPDATE SET decision = excluded.decision, reason = excluded.reason, decided_at = excluded.decided_at`
    ).run(tenderId, decision, cleanReason(reason), decidedAt);
    return this.getReview(tenderId)!;
  }

  getReview(tenderId: string): TenderReviewRow | undefined {
    return this.db.prepare('SELECT * FROM tender_reviews WHERE tender_id = ?').get(tenderId) as TenderReviewRow | undefined;
  }

  findDocument(tenderId: string, sourceUrl: string): TenderDocumentRow | undefined {
    return this.db.prepare('SELECT * FROM tender_documents WHERE tender_id = ? AND source_url = ?')
      .get(tenderId, sourceUrl) as TenderDocumentRow | undefined;
  }

  upsertDocument(tenderId: string, sourceUrl: string, fileName: string): TenderDocumentRow {
    const existing = this.db.prepare(
      'SELECT * FROM tender_documents WHERE tender_id = ? AND source_url = ?'
    ).get(tenderId, sourceUrl) as TenderDocumentRow | undefined;
    if (existing) return existing;
    const row: TenderDocumentRow = {
      id: randomUUID(), tender_id: tenderId, source_url: sourceUrl, file_name: fileName,
      local_path: null, state: 'PENDING', checksum_sha256: null, error: null,
      downloaded_at: null, updated_at: new Date().toISOString(),
    };
    this.db.prepare(
      `INSERT INTO tender_documents
       (id, tender_id, source_url, file_name, local_path, state, checksum_sha256, error, downloaded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(row.id, row.tender_id, row.source_url, row.file_name, row.local_path, row.state,
      row.checksum_sha256, row.error, row.downloaded_at, row.updated_at);
    return row;
  }

  completeDocument(id: string, fileName: string, localPath: string, checksum: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE tender_documents SET state = 'DOWNLOADED', file_name = ?, local_path = ?, checksum_sha256 = ?,
       error = NULL, downloaded_at = ?, updated_at = ? WHERE id = ?`
    ).run(fileName, localPath, checksum, now, now, id);
  }

  failDocument(id: string, error: string): void {
    this.db.prepare(
      `UPDATE tender_documents SET state = 'FAILED', error = ?, updated_at = ? WHERE id = ?`
    ).run(error.slice(0, 2000), new Date().toISOString(), id);
  }

  /** Records what was read from inside a saved document. */
  saveDocumentText(id: string, read: { text: string; method: 'TEXT' | 'OCR' | 'MIXED' | 'NONE'; pages: number; ocrPages: number }, at = new Date().toISOString()): void {
    this.db.prepare(
      `UPDATE tender_documents SET text_content = ?, text_method = ?, text_pages = ?, text_ocr_pages = ?, text_read_at = ? WHERE id = ?`
    ).run(read.text || null, read.method, read.pages, read.ocrPages, at, id);
  }

  listDocuments(tenderId: string): TenderDocumentRow[] {
    return this.db.prepare(
      'SELECT * FROM tender_documents WHERE tender_id = ? ORDER BY file_name ASC, rowid ASC'
    ).all(tenderId) as unknown as TenderDocumentRow[];
  }

  saveRequirements(tenderId: string, data: unknown, confidence: ExtractionConfidence): TenderRequirementRow {
    const extractedAt = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO tender_requirements (tender_id, data_json, confidence, extracted_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(tender_id) DO UPDATE SET data_json = excluded.data_json,
       confidence = excluded.confidence, extracted_at = excluded.extracted_at`
    ).run(tenderId, JSON.stringify(data), confidence, extractedAt);
    return this.getRequirements(tenderId)!;
  }

  getRequirements(tenderId: string): TenderRequirementRow | undefined {
    return this.db.prepare('SELECT * FROM tender_requirements WHERE tender_id = ?').get(tenderId) as TenderRequirementRow | undefined;
  }

  deleteForJob(jobId: string): void {
    for (const table of ['tender_documents', 'tender_requirements', 'tender_reviews']) {
      this.db.prepare(`DELETE FROM ${table} WHERE tender_id IN (SELECT id FROM tenders WHERE job_id = ?)`).run(jobId);
    }
  }
}
