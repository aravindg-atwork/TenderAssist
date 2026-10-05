import type { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { jobOutputDirectory } from '../../publishing/jobPublisher.js';
import { normalizeOutputStructure, type OutputStructureSettings } from '../../publishing/outputStructure.js';

export interface JobOutputPlan {
  jobId: string;
  outputRoot: string;
  outputDate: string;
  structure: OutputStructureSettings;
  jobDirectory: string;
  /** 1 for the first job publishing into a day folder, 2 for the next, and so on. */
  runNumber: number;
}

interface PlanRow {
  job_id: string;
  output_root: string;
  output_date: string;
  structure_json: string;
  run_number: number;
}

// Windows paths are case-insensitive, so two spellings of one folder share a key.
const directoryKey = (directory: string) => resolve(directory).toLocaleLowerCase();

export class JobOutputRepository {
  constructor(private db: DatabaseSync) {}

  getPlan(jobId: string): JobOutputPlan | undefined {
    const row = this.db.prepare('SELECT * FROM job_output_plans WHERE job_id = ?').get(jobId) as PlanRow | undefined;
    if (!row) return undefined;
    const structure = normalizeOutputStructure(JSON.parse(row.structure_json) as OutputStructureSettings);
    return {
      jobId: row.job_id,
      outputRoot: row.output_root,
      outputDate: row.output_date,
      structure,
      jobDirectory: jobOutputDirectory(row.output_root, row.output_date, row.job_id, structure),
      runNumber: row.run_number,
    };
  }

  /** Returns the job's frozen plan, creating it from the given settings on first use. */
  getOrCreatePlan(jobId: string, outputRoot: string, outputDate: string, structure: OutputStructureSettings): JobOutputPlan {
    const existing = this.getPlan(jobId);
    if (existing) return existing;
    const normalized = normalizeOutputStructure(structure);
    const key = directoryKey(jobOutputDirectory(outputRoot, outputDate, jobId, normalized));
    const { next } = this.db.prepare(
      'SELECT COALESCE(MAX(run_number), 0) + 1 AS next FROM job_output_plans WHERE directory_key = ?'
    ).get(key) as { next: number };
    this.db.prepare(
      `INSERT INTO job_output_plans (job_id, output_root, output_date, structure_json, directory_key, run_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(jobId, outputRoot, outputDate, JSON.stringify(normalized), key, next, new Date().toISOString());
    return this.getPlan(jobId)!;
  }

  /** The tender's S.No if it was ever given an output folder. */
  findSerialNumber(tenderId: string): number | undefined {
    const row = this.db.prepare('SELECT serial_number FROM job_output_tenders WHERE tender_id = ?').get(tenderId) as
      | { serial_number: number }
      | undefined;
    return row?.serial_number;
  }

  /**
   * Stable S.No for a tender inside its day folder. Numbers continue across
   * every job sharing the folder and never change once assigned.
   */
  serialNumberFor(plan: JobOutputPlan, tenderId: string): number {
    const existing = this.db.prepare(
      'SELECT serial_number FROM job_output_tenders WHERE tender_id = ?'
    ).get(tenderId) as { serial_number: number } | undefined;
    if (existing) return existing.serial_number;
    const key = directoryKey(plan.jobDirectory);
    const { next } = this.db.prepare(
      'SELECT COALESCE(MAX(serial_number), 0) + 1 AS next FROM job_output_tenders WHERE directory_key = ?'
    ).get(key) as { next: number };
    this.db.prepare(
      'INSERT INTO job_output_tenders (tender_id, job_id, directory_key, serial_number) VALUES (?, ?, ?, ?)'
    ).run(tenderId, plan.jobId, key, next);
    return next;
  }
}
