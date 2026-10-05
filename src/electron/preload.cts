// src/electron/preload.cts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TenderAssistApi, AuthJobUpdate, AppNavigationCommand } from './ipcTypes.js';
import type { UpdateStatus } from './updateService.js';

const api: TenderAssistApi = {
  listJobs: () => ipcRenderer.invoke('list-jobs'),
  getRunSettings: () => ipcRenderer.invoke('get-run-settings'),
  saveRunSettings: (defaults) => ipcRenderer.invoke('save-run-settings', defaults),
  getPortalCredentialSettings: (portalId) => ipcRenderer.invoke('get-portal-credential-settings', portalId),
  savePortalCredentials: (portalId, input) => ipcRenderer.invoke('save-portal-credentials', portalId, input),
  getPublishingSettings: (portalId) => ipcRenderer.invoke('get-publishing-settings', portalId),
  savePublishingSettings: (portalId, settings) => ipcRenderer.invoke('save-publishing-settings', portalId, settings),
  getAutomationPacing: () => ipcRenderer.invoke('get-automation-pacing'),
  saveAutomationPacing: (settings) => ipcRenderer.invoke('save-automation-pacing', settings),
  selectPublishingFolder: (initialPath) => ipcRenderer.invoke('select-publishing-folder', initialPath),
  getRunHistory: (portalId) => ipcRenderer.invoke('get-run-history', portalId),
  openJobOutput: (jobId) => ipcRenderer.invoke('open-job-output', jobId),
  getRecoveryJob: () => ipcRenderer.invoke('get-recovery-job'),
  dismissRecoveryJob: (jobId) => ipcRenderer.invoke('dismiss-recovery-job', jobId),
  resumeJob: (jobId) => ipcRenderer.invoke('resume-job', jobId),
  saveTenderReview: (tenderId, decision, reason) => ipcRenderer.invoke('save-tender-review', tenderId, decision, reason),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  restartToInstallUpdate: () => ipcRenderer.invoke('restart-to-install-update'),
  onUpdateStatus: (callback) => {
    const listener = (_event: IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  runPreflight: (portalId) => ipcRenderer.invoke('run-preflight', portalId),
  setPortalBounds: (bounds) => ipcRenderer.invoke('set-portal-bounds', bounds),
  setPortalVisible: (visible) => ipcRenderer.invoke('set-portal-visible', visible),
  portalGoBack: () => ipcRenderer.invoke('portal-go-back'),
  portalReload: () => ipcRenderer.invoke('portal-reload'),
  getTextSize: () => ipcRenderer.invoke('get-text-size'),
  saveTextSize: (textSize) => ipcRenderer.invoke('save-text-size', textSize),
  getPortalZoom: (portalId) => ipcRenderer.invoke('get-portal-zoom', portalId),
  setPortalZoom: (portalId, percent) => ipcRenderer.invoke('set-portal-zoom', portalId, percent),
  launchDscSigner: (jobId) => ipcRenderer.invoke('launch-dsc-signer', jobId),
  cancelJob: (jobId) => ipcRenderer.invoke('cancel-job', jobId),
  openHelpLink: (url) => ipcRenderer.invoke('open-help-link', url),
  startJob: (config, untilDate, options) => ipcRenderer.invoke('start-job', config, untilDate, options),
  runMoreDates: (from, to, options) => ipcRenderer.invoke('run-more-dates', from, to, options),
  finishRun: () => ipcRenderer.invoke('finish-run'),
  getJobDetail: (jobId) => ipcRenderer.invoke('get-job-detail', jobId),
  deleteJob: (jobId) => ipcRenderer.invoke('delete-job', jobId),
  onJobUpdate: (callback) => {
    const listener = (_event: IpcRendererEvent, update: AuthJobUpdate) => callback(update);
    ipcRenderer.on('job-updated', listener);
    return () => ipcRenderer.removeListener('job-updated', listener);
  },
  getInbox: () => ipcRenderer.invoke('get-inbox'),
  decideTenders: (opportunityIds, decision, note) => ipcRenderer.invoke('decide-tenders', opportunityIds, decision, note),
  acknowledgeRuns: (jobIds) => ipcRenderer.invoke('acknowledge-runs', jobIds),
  acknowledgeTenderChanges: (opportunityIds) => ipcRenderer.invoke('acknowledge-tender-changes', opportunityIds),
  dismissRelatedTender: (opportunityId, otherId) => ipcRenderer.invoke('dismiss-related-tender', opportunityId, otherId),
  getTenders: () => ipcRenderer.invoke('get-tenders'),
  getTenderTimeline: (opportunityId) => ipcRenderer.invoke('get-tender-timeline', opportunityId),
  onAppNavigation: (callback) => {
    const listener = (_event: IpcRendererEvent, command: AppNavigationCommand) => callback(command);
    ipcRenderer.on('app-navigate', listener);
    return () => ipcRenderer.removeListener('app-navigate', listener);
  },
};

contextBridge.exposeInMainWorld('tenderAssist', api);
