// renderer/src/global.d.ts
import type { TenderAssistApi } from '../../src/electron/ipcTypes';

declare global {
  interface Window {
    tenderAssist: TenderAssistApi;
  }
}

export {};
