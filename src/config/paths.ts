import { homedir } from 'node:os';
import { join } from 'node:path';

/** The app's data folder: "TenderAssist", or "TenderAssist Dev" for the dev build (src/config/buildChannel.ts). */
export function getAppDataDir(env: NodeJS.ProcessEnv = process.env, folderName = 'TenderAssist'): string {
  const base = env.APPDATA ?? join(homedir(), '.config');
  return join(base, folderName);
}

export function getDatabasePath(env: NodeJS.ProcessEnv = process.env, folderName = 'TenderAssist'): string {
  return join(getAppDataDir(env, folderName), 'tenderassist.db');
}
