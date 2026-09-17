import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolveChromePath, buildChromeLaunchArgs } from '../../src/browser/chromeLauncher.js';

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

  it.skipIf(!existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'))(
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

import { afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, waitForCdpReady } from '../../src/browser/chromeLauncher.js';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

describe('launchChrome + waitForCdpReady', () => {
  let tempDirs: string[] = [];
  let procs: Array<{ pid?: number }> = [];

  afterEach(() => {
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
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // directory might still be locked by terminating processes
      }
    }
    tempDirs = [];
  });

  it.skipIf(!existsSync(CHROME_PATH))(
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
});
