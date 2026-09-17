import { resolveChromePath } from '../../src/browser/chromeLauncher.js';

export function findChrome(): string | undefined {
  try {
    return resolveChromePath();
  } catch {
    return undefined;
  }
}

export const CHROME_PATH = findChrome();
