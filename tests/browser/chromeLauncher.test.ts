import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveChromePath, buildChromeLaunchArgs, launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';
import { CHROME_PATH } from '../support/chrome.js';
import { removeDirWithRetry } from '../support/removeDirWithRetry.js';

describe('resolveChromePath', () => {
  it('returns the first candidate path that exists', () => {
    const candidates = ['C:\\fake\\chrome.exe', 'C:\\real\\chrome.exe'];
    const exists = (path: string) => path === 'C:\\real\\chrome.exe';

    expect(resolveChromePath(candidates, exists)).toBe('C:\\real\\chrome.exe');
  });

  it('prefers the first matching candidate over a later one', () => {
    const candidates = ['C:\\first\\chrome.exe', 'C:\\second\\chrome.exe'];
    const exists = () => true;

    expect(resolveChromePath(candidates, exists)).toBe('C:\\first\\chrome.exe');
  });

  it('throws when no candidate exists', () => {
    const candidates = ['C:\\fake\\chrome.exe'];
    const exists = () => false;

    expect(() => resolveChromePath(candidates, exists)).toThrow(
      'Google Chrome not found in standard install locations'
    );
  });

  it.skipIf(!CHROME_PATH)(
    'finds the real Chrome install on this machine using the default candidates',
    () => {
      expect(() => resolveChromePath()).not.toThrow();
      expect(resolveChromePath()).toContain('chrome.exe');
    }
  );

  it('resolves the per-user (non-admin install) Chrome path when injected as a candidate', () => {
    const perUserPath = 'C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      perUserPath,
    ];
    const exists = (path: string) => path === perUserPath;

    expect(resolveChromePath(candidates, exists)).toBe(perUserPath);
  });
});

describe('buildChromeLaunchArgs', () => {
  it('builds the expected CDP and profile arguments', () => {
    const args = buildChromeLaunchArgs({ userDataDir: 'C:\\Users\\test\\TenderAssist\\profile', cdpPort: 9222 });

    expect(args).toEqual([
      '--remote-debugging-port=9222',
      '--user-data-dir=C:\\Users\\test\\TenderAssist\\profile',
      '--no-first-run',
      '--no-default-browser-check',
    ]);
  });
});

describe('launchChrome + waitForCdpReady', () => {
  let tempDirs: string[] = [];
  let procs: Array<{ pid?: number }> = [];

  afterEach(async () => {
    for (const proc of procs) {
      if (proc.pid) {
        try {
          process.kill(proc.pid);
        } catch {
          // already exited
        }
      }
    }
    procs = [];
    for (const dir of tempDirs) {
      await removeDirWithRetry(dir);
    }
    tempDirs = [];
  });

  it.skipIf(!CHROME_PATH)(
    'launches Chrome and the CDP endpoint becomes ready',
    async () => {
      const userDataDir = mkdtempSync(join(tmpdir(), 'tenderassist-chrome-test-'));
      tempDirs.push(userDataDir);
      const port = 9222 + Math.floor(Math.random() * 5000);

      const proc = launchChrome({ userDataDir, cdpPort: port });
      procs.push(proc);

      const info = await waitForCdpReady(port, 10000);
      expect(info.Browser).toContain('Chrome');
      expect(info.webSocketDebuggerUrl).toContain(`:${port}`);
    },
    15000
  );

  it('waitForCdpReady rejects when nothing is listening on the port', async () => {
    await expect(waitForCdpReady(9, 500)).rejects.toThrow('did not become ready');
  });

  it('does not crash the process when spawn fails for a bad chrome path', async () => {
    // Before the 'error' listener was added in launchChrome, a bad path
    // here would emit an unhandled 'error' event on the ChildProcess and
    // crash this whole test worker instead of failing gracefully. Since
    // spawn failures on Windows surface asynchronously, give the event
    // loop a tick to prove no crash occurred, then confirm the caller's
    // own timeout path (waitForCdpReady) still reports cleanly.
    const port = 9222 + Math.floor(Math.random() * 5000);
    const proc = launchChrome({ userDataDir: tmpdir(), cdpPort: port }, 'C:\\definitely\\not\\a\\real\\chrome.exe');
    procs.push(proc);

    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(waitForCdpReady(port, 300)).rejects.toThrow('did not become ready');
  });
});
