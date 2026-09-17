import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

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

export interface CdpVersionInfo {
  Browser: string;
  webSocketDebuggerUrl: string;
}

export function launchChrome(options: ChromeLaunchOptions, chromePath: string = resolveChromePath()): ChildProcess {
  const args = buildChromeLaunchArgs(options);
  const proc = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  proc.unref();
  return proc;
}

export async function waitForCdpReady(port: number, timeoutMs = 10000): Promise<CdpVersionInfo> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return (await response.json()) as CdpVersionInfo;
      }
    } catch {
      // Chrome isn't accepting connections yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome did not become ready on CDP port ${port} within ${timeoutMs}ms`);
}
