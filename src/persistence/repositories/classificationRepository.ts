import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type ClassificationGate = 'G1' | 'G2' | 'G3' | 'G4';
export type ClassificationResult = 'PASS' | 'REJECT' | 'UNCERTAIN' | 'NOT_RUN';
export type FinalClassification = 'KEEP' | 'REJECT' | 'UNCERTAIN' | 'NOT_RUN';

export interface ClassificationGateRow {
  id: string;
  tender_id: string;
  gate: ClassificationGate;
  result: ClassificationResult;
  reason_code: string;
  evidence_json: string;
  classifier_version: string;
  evaluated_at: string;
}

export interface SaveGateInput {
  tenderId: string;
  gate: ClassificationGate;
  result: ClassificationResult;
  reasonCode: string;
  evidence: unknown;
  classifierVersion: string;
}

export function finalClassification(rows: ClassificationGateRow[]): FinalClassification {
  if (rows.length === 0 || rows.some((row) => row.result === 'NOT_RUN')) return 'NOT_RUN';
  if (rows.some((row) => row.result === 'REJECT')) return 'REJECT';
  if (rows.length < 4 || rows.some((row) => row.result === 'UNCERTAIN')) return 'UNCERTAIN';
  return 'KEEP';
}

export class ClassificationRepository {
  constructor(private db: DatabaseSync) {}

  saveGate(input: SaveGateInput): ClassificationGateRow {
    const evaluatedAt = new Date().toISOString();
    const row: ClassificationGateRow = {
      id: randomUUID(),
      tender_id: input.tenderId,
      gate: input.gate,
      result: input.result,
      reason_code: input.reasonCode,
      evidence_json: JSON.stringify(input.evidence),
      classifier_version: input.classifierVersion,
      evaluated_at: evaluatedAt,
    };
    this.db
      .prepare(
        `INSERT INTO tender_classification_gates
           (id, tender_id, gate, result, reason_code, evidence_json, classifier_version, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tender_id, gate) DO UPDATE SET
           result = excluded.result,
           reason_code = excluded.reason_code,
           evidence_json = excluded.evidence_json,
           classifier_version = excluded.classifier_version,
           evaluated_at = excluded.evaluated_at`
      )
      .run(
        row.id,
        row.tender_id,
        row.gate,
        row.result,
        row.reason_code,
        row.evidence_json,
        row.classifier_version,
        row.evaluated_at
      );
    return this.listForTender(input.tenderId).find((saved) => saved.gate === input.gate)!;
  }

  listForTender(tenderId: string): ClassificationGateRow[] {
    return this.db
      .prepare('SELECT * FROM tender_classification_gates WHERE tender_id = ? ORDER BY gate ASC')
      .all(tenderId) as unknown as ClassificationGateRow[];
  }

  getFinalForTender(tenderId: string): FinalClassification {
    return finalClassification(this.listForTender(tenderId));
  }

  deleteForJob(jobId: string): void {
    this.db
      .prepare(
        `DELETE FROM tender_classification_gates
         WHERE tender_id IN (SELECT id FROM tenders WHERE job_id = ?)`
      )
      .run(jobId);
  }
}
