import { homedir } from 'node:os';
import { join } from 'node:path';

export function getAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.APPDATA ?? join(homedir(), '.config');
  return join(base, 'TenderAssist');
}

export function getDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getAppDataDir(env), 'tenderassist.db');
}
