import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ChromeLaunchOptions {
  userDataDir: string;
  cdpPort: number;
}

const DEFAULT_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ...(process.env.LOCALAPPDATA
    ? [join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')]
    : []),
];

export function resolveChromePath(
  candidates: string[] = DEFAULT_CHROME_PATHS,
  exists: (path: string) => boolean = existsSync
): string {
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  throw new Error('Google Chrome not found in standard install locations');
}

export function buildChromeLaunchArgs(options: ChromeLaunchOptions): string[] {
  return [
    `--remote-debugging-port=${options.cdpPort}`,
    `--user-data-dir=${options.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
}
