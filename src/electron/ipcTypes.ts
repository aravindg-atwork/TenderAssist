// src/electron/ipcTypes.ts
import type { JobState } from '../persistence/repositories/jobRepository.js';
import type { AuthState } from '../persistence/repositories/authSessionRepository.js';
import type { StateTransitionRow } from '../persistence/repositories/stateTransitionRepository.js';
import type { AuthJobUpdate } from '../orchestration/authJobRunner.js';
import type { TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { SearchRow } from '../persistence/repositories/searchRepository.js';

export interface JobListItem {
  jobId: string;
  jobState: JobState;
  authState: AuthState | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobDetail {
  jobId: string;
  jobState: JobState;
  authSessionId: string | null;
  authState: AuthState | null;
  jobTransitions: StateTransitionRow[];
  authTransitions: StateTransitionRow[];
  tenders: TenderRow[];
  searches: SearchRow[];
}

export type { AuthJobUpdate };

export interface TenderAssistApi {
  listJobs(): Promise<JobListItem[]>;
  startJob(): Promise<{ jobId: string }>;
  getJobDetail(jobId: string): Promise<JobDetail>;
  deleteJob(jobId: string): Promise<void>;
  onJobUpdate(callback: (update: AuthJobUpdate) => void): () => void;
}
