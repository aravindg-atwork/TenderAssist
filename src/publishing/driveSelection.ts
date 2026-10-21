import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// What of a tender's saved folder goes to Google Drive: the files a bidder
// needs, not everything GeM attaches. Everything stays on this computer.

/**
 * Forms GeM attaches to every custom bid for the buyer's own side (the
 * buyer's availability report and the competent authority's undertaking);
 * also when saved as the original bid's files of a reverse auction.
 */
const GEM_STANDARD_FORMS = [
  /^(?:Original bid - )?GEM Availability Report\b/i,
  /^(?:Original bid - )?Undertaking of Competent Authority\b/i,
];

export function isGemStandardForm(fileName: string): boolean {
  return GEM_STANDARD_FORMS.some((pattern) => pattern.test(fileName));
}

/**
 * The files of one folder (and its sub-folders) to send to Drive, by path:
 * no GeM standard forms, and a file attached under several names (GeM buyers
 * often upload one PDF as "Scope of Work", "Service level agreement" and
 * more) sent once, under its shortest name.
 */
export function filesForDrive(directory: string): Set<string> {
  const byContent = new Map<string, string[]>();
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder)) {
      const path = join(folder, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (isGemStandardForm(entry)) continue;
      const key = `${folder}|${createHash('md5').update(readFileSync(path)).digest('hex')}`;
      byContent.set(key, [...(byContent.get(key) ?? []), path]);
    }
  };
  walk(directory);
  const kept = new Set<string>();
  for (const paths of byContent.values()) {
    kept.add([...paths].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]);
  }
  return kept;
}
