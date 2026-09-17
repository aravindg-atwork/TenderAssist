import { describe, it, expect } from 'vitest';
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

  it('finds the real Chrome install on this machine using the default candidates', () => {
    expect(() => resolveChromePath()).not.toThrow();
    expect(resolveChromePath()).toContain('chrome.exe');
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
