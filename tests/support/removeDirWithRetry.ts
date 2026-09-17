import { rmSync } from 'node:fs';

/**
 * Windows holds a transient handle on a Chrome profile directory for a few
 * hundred milliseconds after the process is killed. Chrome is always killed
 * before this is called, so retrying releases the handle rather than masking
 * a live-process leak.
 *
 * The 10x200ms (~2s) budget was verified sufficient in an isolated single-file
 * probe, but measured against a full `npm test` run -- three real-Chrome test
 * files' worth of spawn/kill cycles happening concurrently across Vitest's
 * parallel workers, not just one file at a time -- about half the profile
 * dirs still weren't released in time (29/55 in a 5-run measurement here).
 * Widened to a ~6s budget (30x200ms) to match that heavier realistic
 * contention; still gives up quietly rather than failing a passing test.
 */
export async function removeDirWithRetry(dir: string, attempts = 30, delayMs = 200): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Give up quietly: a leftover temp profile must never fail a passing test.
}
