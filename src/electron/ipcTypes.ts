// src/electron/ipcTypes.ts
import type { JobState } from '../persistence/repositories/jobRepository.js';
import type { AuthState } from '../persistence/repositories/authSessionRepository.js';
import type { StateTransitionRow } from '../persistence/repositories/stateTransitionRepository.js';
import type { AuthJobUpdate } from '../orchestration/authJobRunner.js';
import type { RunQuestion, RunQuestionAnswer } from '../orchestration/runQuestion.js';
import type { TenderRow } from '../persistence/repositories/tenderRepository.js';
import type { SearchRow } from '../persistence/repositories/searchRepository.js';
import type { RunConfiguration, RunDefaults } from '../config/runConfiguration.js';
import type {
  ClassificationGateRow,
  FinalClassification,
} from '../persistence/repositories/classificationRepository.js';
import type { WordSuggestions } from '../review/wordSuggestions.js';
import type { PortalCategoryList } from '../persistence/repositories/portalCategoryRepository.js';
import type { PublishingSettings } from '../persistence/repositories/publishingSettingsRepository.js';
import type { TenderDocumentRow, TenderRequirementRow, TenderReviewRow, ManualTenderDecision } from '../persistence/repositories/tenderWorkflowRepository.js';
import type { UpdateStatus } from './updateService.js';
import type { PreflightReport } from '../system/preflight.js';
import type { AutomationPacingSettings } from '../persistence/repositories/automationSettingsRepository.js';
import type { TextSize } from '../persistence/repositories/displaySettingsRepository.js';
import type { InboxView, TenderSummary } from '../review/inbox.js';
import type { OperatorDecision, OpportunityLifecycle } from '../state/opportunityLifecycle.js';

import type { TendersView } from '../review/tenders.js';
import type { TimelineEntry } from '../review/timeline.js';
import type { TenderFileView } from '../review/tenderFile.js';

export type { InboxItem, InboxView, TenderSummary } from '../review/inbox.js';
export type { TendersView } from '../review/tenders.js';
export type { TimelineEntry } from '../review/timeline.js';
export type { TenderField, TenderFileView } from '../review/tenderFile.js';
export type { OperatorDecision } from '../state/opportunityLifecycle.js';
import type { CategoryHealth, CategorySuggestion, MissingCategory, ReplacementAdvice } from '../config/categoryHealth.js';
import type { DailyReport, DayRow, CategoryRow } from '../review/dailyReport.js';
export type { DailyReport, DayRow, CategoryRow };
export type { CategoryHealth, CategorySuggestion, MissingCategory, ReplacementAdvice };
export type { PortalCategoryList, RunQuestion, RunQuestionAnswer, WordSuggestions };
export type { WordSuggestion } from '../review/wordSuggestions.js';

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

export type SettingsSection = 'folders' | 'relevance';

export interface AppNavigationCommand {
  view: 'inbox' | 'tenders' | 'jobs' | 'settings';
  section?: SettingsSection;
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
  /** A check for changes: what this run found for the tender (extension, corrigendum, cancelled); empty when nothing changed. */
  changesFound?: string[];
}

/** One tender found in the live sign-in, with TenderAssist's verdict and why. */
export interface LiveSessionTender {
  opportunityId: string;
  tenderId: string;
  title: string;
  organisation: string | null;
  closingDate: string | null;
  recommendation: 'KEEP' | 'REJECT' | 'UNCERTAIN' | null;
  lifecycle: OpportunityLifecycle;
  reason: string;
  filesSaved: boolean;
}

export interface LiveSessionView {
  tenders: LiveSessionTender[];
  /** Approved tenders on this website whose documents are not saved yet. */
  approvedWaitingForDocuments: number;
}

/** One tender behind a number in the daily report. */
export interface ReportTenderItem {
  opportunityId: string;
  tenderId: string;
  title: string;
  /** Published day it was found under. */
  date: string;
  closingDate: string | null;
  verdict: 'KEEP' | 'UNCERTAIN' | 'REJECT' | 'NOT_RUN';
  approved: boolean;
  lifecycle: OpportunityLifecycle | null;
  reason: string;
}

export interface DailyReportView extends DailyReport {
  portalId: string;
  gem: boolean;
  /** When the website's totals were last read; null when never. */
  totalsReadAt: string | null;
  /** A refresh of the website's totals is running now. */
  totalsReading: boolean;
  /** GeM: whether product bids are counted as well as service bids. */
  gemProductsIncluded?: boolean;
}

export interface RecoveryJob {
  jobId: string;
  state: JobState;
  config: RunConfiguration;
  /** How Continue would pick the run back up; START_OVER means only a fresh run is possible. */
  resume: 'SELECT_TENDERS' | 'COLLECT_DOCUMENTS' | 'START_OVER';
  resumeDescription: string;
}

export interface JobListItem {
  jobId: string;
  jobState: JobState;
  authState: AuthState | null;
  createdAt: string;
  updatedAt: string;
  portalId: string;
  searchDate: string | null;
  /** Tenders the run saw, and how many of them it kept. For a documents run: tenders it collected for, and how many now have files. */
  tendersFound: number;
  kept: number;
  /** SEARCH searches a published date; DOCUMENTS only collects approved tenders' documents. */
  purpose: 'SEARCH' | 'DOCUMENTS' | 'CHANGES';
}

/** Approved tenders still waiting for their documents. */
/** Google Drive upload settings as the screen sees them; secrets never leave the main process. */
export interface GoogleDriveStatus {
  /** Whether this build includes TenderAssist's Google sign-in. */
  available: boolean;
  /** The Google sign-in address while a sign-in waits, to open it in another browser. */
  signInLink: string | null;
  folderId: string;
  /** The folder's name on Drive, once checked. */
  folderName: string;
  /** The Google account uploads are made as, once signed in. */
  accountEmail: string;
  signedIn: boolean;
  encryptionAvailable: boolean;
  uploadMode: 'SAVED' | 'APPROVED';
  /** An upload is running now. */
  uploading: boolean;
  /** The last upload in this session, if any. */
  lastUpload: { at: string; uploaded: number; failed: number; problem: string | null } | null;
}

export interface DocumentsWaiting {
  /** In My Tenders, so a documents run can open them. */
  ready: number;
  /** Never reached My Tenders: their date has to be searched again. */
  notInMyTenders: Array<{ opportunityId: string; title: string; foundOnDate: string | null }>;
}

export interface JobDetail {
  jobId: string;
  jobState: JobState;
  purpose: 'SEARCH' | 'DOCUMENTS' | 'CHANGES';
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
  /** The website's own Product Category list, as the last search read it. */
  /** For GeM, read from GeM itself; product categories are added only when asked. */
  getPortalCategories(portalId: string, options?: { includeProducts?: boolean }): Promise<PortalCategoryList>;
  /** Chosen categories no longer on the website's list, and categories new on it. */
  getCategoryHealth(portalId: string): Promise<CategoryHealth>;
  /** What to search instead of a category the website dropped, led by where wanted tenders were listed. */
  suggestCategoryReplacements(portalId: string, missingName: string): Promise<ReplacementAdvice>;
  /** The operator has seen today's new categories; stop showing them as new. */
  markNewCategoriesLooked(portalId: string): Promise<void>;
  /** Words to consider adding, learnt from tenders the operator approved and rejected. */
  getWordSuggestions(): Promise<WordSuggestions>;
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
  /** Continue an interrupted run on the same job from its shortlist or document collection. */
  resumeJob(jobId: string): Promise<{ jobId: string; plan: RecoveryJob['resume'] }>;
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
  /** Asks the portal for a fresh DSC signer file (clicks DSC Login again); launch it when ready. */
  refreshDscSigner(jobId: string): Promise<void>;
  cancelJob(jobId: string): Promise<void>;
  /** Opens an allowed help page, such as the OpenWebStart download, in the default browser. */
  openHelpLink(url: string): Promise<void>;
  /**
   * Start a run for one published date, or for each date from
   * `config.searchDate` to `untilDate` in one sign-in. Dates that already
   * have a completed run are skipped, unless `runAgain` is set.
   */
  startJob(config: RunConfiguration, untilDate?: string, options?: { runAgain?: boolean }): Promise<{ jobId: string; dates: string[]; skipped: string[] }>;
  /** While the run waits after its last date: run these published dates in the same sign-in. */
  runMoreDates(from: string, to: string, options?: { runAgain?: boolean }): Promise<{ toRun: string[]; skipped: string[] }>;
  /** Approved tenders still waiting for their documents. */
  getDocumentsWaiting(portalId: string): Promise<DocumentsWaiting>;
  /** Signs in and collects only the documents of approved tenders in My Tenders. */
  startDocumentRun(portalId: string): Promise<{ jobId: string; count: number }>;
  /** Tenders followed for extensions and corrigenda: approved, decide later, waiting; open or just closed. */
  getFollowedTenders(portalId: string): Promise<{ followed: number }>;
  /** Sign in and reopen the followed tenders' pages to record extensions and corrigenda. */
  startChangeCheck(portalId: string): Promise<{ jobId: string; count: number }>;
  /** While a run waits signed in ("What next?"): check the followed tenders again, no new sign-in. */
  checkChangesInRun(): Promise<void>;
  /** While a run waits signed in: collect approved tenders' documents, no new sign-in. */
  collectDocumentsInRun(): Promise<void>;
  /** The live sign-in's tenders, to approve or reject on the spot. */
  getLiveSession(): Promise<LiveSessionView>;
  /** Per published day: on the website, in your categories, shortlisted, approved, by category. */
  getDailyReport(portalId: string, from: string, to: string): Promise<DailyReportView>;
  /** Reads the website's public lists again for its daily totals (GePNIC websites; about two minutes). */
  refreshWebsiteTotals(portalId: string): Promise<void>;
  /** The tenders behind a category in the daily report, over a day or a range of days. */
  getReportTenders(portalId: string, from: string, to: string, category: string): Promise<ReportTenderItem[]>;
  /** One tender's summary, to open its file. */
  getTenderSummary(opportunityId: string): Promise<TenderSummary>;
  /** Answers the run's "Keep or skip?" question about an unsure tender. */
  answerRunQuestion(questionId: string, answer: RunQuestionAnswer): Promise<void>;
  getGoogleDrive(): Promise<GoogleDriveStatus>;
  /** Saves the Drive folder link (checked straight away when signed in). */
  saveGoogleDrive(input: { folderLink?: string; uploadMode?: 'SAVED' | 'APPROVED' }): Promise<GoogleDriveStatus>;
  /** Uploads every tender folder and report sheet saved on this computer; unchanged files are skipped. Resolves when done. */
  uploadEverythingToGoogleDrive(): Promise<GoogleDriveStatus>;
  /** Opens Google sign-in in the browser and waits for it to finish. */
  connectGoogleDrive(): Promise<GoogleDriveStatus>;
  checkGoogleDrive(): Promise<GoogleDriveStatus>;
  disconnectGoogleDrive(): Promise<GoogleDriveStatus>;
  /** Opens the open question's own document (a GeM bid PDF) in the browser. */
  openQuestionDocument(questionId: string): Promise<void>;
  /** While the run waits after its last date: sign out and finish. */
  finishRun(): Promise<void>;
  /** Opens the app menu (backup, restore, exports, about) at a point in the window. */
  showAppMenu(x: number, y: number): Promise<void>;
  /** After the last date: finish this sign-in and search another website. */
  switchPortalRun(config: RunConfiguration, untilDate?: string, options?: { runAgain?: boolean }): Promise<{ jobId: string; dates: string[]; skipped: string[] }>;
  getJobDetail(jobId: string): Promise<JobDetail>;
  deleteJob(jobId: string): Promise<void>;
  onJobUpdate(callback: (update: AuthJobUpdate) => void): () => void;
  onAppNavigation(callback: (command: AppNavigationCommand) => void): () => void;
  /** Whether the portal holds back the operator's clicks while a run drives it. */
  getPortalLock(): Promise<{ locked: boolean; overridden: boolean }>;
  /** Take control of the portal during a run (true), or hand it back to TenderAssist (false). */
  setPortalControl(take: boolean): Promise<{ locked: boolean; overridden: boolean }>;
  onPortalLock(callback: (state: { locked: boolean; overridden: boolean }) => void): () => void;
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
  /** A tender's portal fields, key facts, and documents. */
  getTenderFile(opportunityId: string): Promise<TenderFileView>;
  /** Opens the tender's saved folder (documents, zip, eligibility sheet). */
  openTenderFolder(opportunityId: string): Promise<void>;
}
