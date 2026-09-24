// src/electron/ipcTypes.ts
import type { JobState } from '../persistence/repositories/jobRepository.js';
import type { AuthState } from '../persistence/repositories/authSessionRepository.js';
import type { StateTransitionRow } from '../persistence/repositories/stateTransitionRepository.js';
import type { AuthJobUpdate } from '../orchestration/authJobRunner.js';
import type { TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { SearchRow } from '../persistence/repositories/searchRepository.js';
import type { RunConfiguration, RunDefaults } from '../config/runConfiguration.js';
import type {
  ClassificationGateRow,
  FinalClassification,
} from '../persistence/repositories/classificationRepository.js';
import type { PublishingSettings } from '../persistence/repositories/publishingSettingsRepository.js';
import type { TenderDocumentRow, TenderRequirementRow, TenderReviewRow, ManualTenderDecision } from '../persistence/repositories/tenderWorkflowRepository.js';
import type { UpdateStatus } from './updateService.js';
import type { PreflightReport } from '../system/preflight.js';
import type { AutomationPacingSettings } from '../persistence/repositories/automationSettingsRepository.js';
import type { TextSize } from '../persistence/repositories/displaySettingsRepository.js';
import type { InboxView } from '../review/inbox.js';
import type { OperatorDecision, OpportunityLifecycle } from '../state/opportunityLifecycle.js';

import type { TendersView } from '../review/tenders.js';
import type { TimelineEntry } from '../review/timeline.js';

export type { InboxItem, InboxView, TenderSummary } from '../review/inbox.js';
export type { TendersView } from '../review/tenders.js';
export type { TimelineEntry } from '../review/timeline.js';
export type { OperatorDecision } from '../state/opportunityLifecycle.js';

export interface RunSettingsState {
  defaults: RunDefaults;
  configured: boolean;
}

export interface PortalCredentialSettings {
  loginId: string;
  hasSavedPassword: boolean;
  encryptionAvailable: boolean;
}

export interface RunHistorySummary {
  recentRunDates: string[];
  missedDates: string[];
}

export interface SavePortalCredentialInput {
  loginId: string;
  password?: string;
  rememberPassword: boolean;
}

export interface PortalBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppNavigationCommand {
  view: 'inbox' | 'tenders' | 'jobs' | 'settings';
  section?: 'folders';
}

export interface TenderDetailItem extends TenderRow {
  classification: FinalClassification;
  classificationGates: ClassificationGateRow[];
  manualReview: TenderReviewRow | null;
  effectiveClassification: 'KEEP' | 'REJECT' | 'UNCERTAIN' | 'NOT_RUN';
  documents: TenderDocumentRow[];
  requirements: TenderRequirementRow | null;
  /** The durable tender's state, so run screens can honour Inbox decisions. */
  opportunityLifecycle: OpportunityLifecycle | null;
}

export interface RecoveryJob {
  jobId: string;
  state: JobState;
  config: RunConfiguration;
}

export interface JobListItem {
  jobId: string;
  jobState: JobState;
  authState: AuthState | null;
  createdAt: string;
  updatedAt: string;
  portalId: string;
  searchDate: string | null;
}

export interface JobDetail {
  jobId: string;
  jobState: JobState;
  authSessionId: string | null;
  authState: AuthState | null;
  jobTransitions: StateTransitionRow[];
  authTransitions: StateTransitionRow[];
  tenders: TenderDetailItem[];
  searches: SearchRow[];
  runConfiguration: RunConfiguration | null;
}

export type { AuthJobUpdate };

export interface TenderAssistApi {
  listJobs(): Promise<JobListItem[]>;
  getRunSettings(): Promise<RunSettingsState>;
  saveRunSettings(defaults: RunDefaults): Promise<RunSettingsState>;
  getPortalCredentialSettings(portalId: string): Promise<PortalCredentialSettings>;
  savePortalCredentials(portalId: string, input: SavePortalCredentialInput): Promise<PortalCredentialSettings>;
  getPublishingSettings(portalId: string): Promise<PublishingSettings>;
  savePublishingSettings(portalId: string, settings: PublishingSettings): Promise<PublishingSettings>;
  getAutomationPacing(): Promise<AutomationPacingSettings>;
  saveAutomationPacing(settings: AutomationPacingSettings): Promise<AutomationPacingSettings>;
  selectPublishingFolder(initialPath?: string): Promise<string | null>;
  getRunHistory(portalId: string): Promise<RunHistorySummary>;
  openJobOutput(jobId: string): Promise<void>;
  getRecoveryJob(): Promise<RecoveryJob | null>;
  dismissRecoveryJob(jobId: string): Promise<void>;
  saveTenderReview(tenderId: string, decision: ManualTenderDecision, reason?: string): Promise<TenderReviewRow>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  restartToInstallUpdate(): Promise<void>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  runPreflight(portalId: string): Promise<PreflightReport>;
  setPortalBounds(bounds: PortalBounds): Promise<void>;
  setPortalVisible(visible: boolean): Promise<void>;
  portalGoBack(): Promise<void>;
  portalReload(): Promise<void>;
  getTextSize(): Promise<TextSize>;
  saveTextSize(textSize: TextSize): Promise<TextSize>;
  /** Portal zoom is a whole percentage, 80-200 in 10% steps, remembered per portal. */
  getPortalZoom(portalId: string): Promise<number>;
  setPortalZoom(portalId: string, percent: number): Promise<number>;
  launchDscSigner(jobId: string): Promise<void>;
  cancelJob(jobId: string): Promise<void>;
  confirmDocumentSelection(jobId: string, tenderIds: string[]): Promise<void>;
  startJob(config: RunConfiguration): Promise<{ jobId: string }>;
  getJobDetail(jobId: string): Promise<JobDetail>;
  deleteJob(jobId: string): Promise<void>;
  onJobUpdate(callback: (update: AuthJobUpdate) => void): () => void;
  onAppNavigation(callback: (command: AppNavigationCommand) => void): () => void;
  getInbox(): Promise<InboxView>;
  /** Approve, reject, defer, or reopen one or many tenders; all or nothing. */
  decideTenders(opportunityIds: string[], decision: OperatorDecision, note?: string): Promise<InboxView>;
  /** Keep the current decision on tenders that changed; they leave the Inbox. */
  acknowledgeTenderChanges(opportunityIds: string[]): Promise<InboxView>;
  /** The operator says a suggested retender is not related; it is not suggested again. */
  dismissRelatedTender(opportunityId: string, otherId: string): Promise<void>;
  /** Acknowledge runs so their automatic rejects leave the Inbox. */
  acknowledgeRuns(jobIds: string[]): Promise<InboxView>;
  getTenders(): Promise<TendersView>;
  getTenderTimeline(opportunityId: string): Promise<TimelineEntry[]>;
}
