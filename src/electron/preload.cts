// src/electron/preload.cts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TenderAssistApi, AuthJobUpdate } from './ipcTypes.js';

const api: TenderAssistApi = {
  listJobs: () => ipcRenderer.invoke('list-jobs'),
  startJob: () => ipcRenderer.invoke('start-job'),
  getJobDetail: (jobId) => ipcRenderer.invoke('get-job-detail', jobId),
  onJobUpdate: (callback) => {
    const listener = (_event: IpcRendererEvent, update: AuthJobUpdate) => callback(update);
    ipcRenderer.on('job-updated', listener);
    return () => ipcRenderer.removeListener('job-updated', listener);
  },
};

contextBridge.exposeInMainWorld('tenderAssist', api);
