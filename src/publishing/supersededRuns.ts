/**
 * Searching a date again replaces what the earlier search of it saved: the
 * day folder, its sheet and Drive keep only the latest finished search
 * (operator, 16 Oct 2026: a second 14-10 GeM search left the first one's 14
 * folders beside its own 28, six bids twice). Runs are compared within one
 * website and one kind of search, so a catch-up search ("closing on or
 * after") never replaces a day's search, and Tamil Nadu never replaces GeM.
 */
export interface DayFolderRun {
  jobId: string;
  /** 1 for the first run saving into the day folder, 2 for the next... */
  runNumber: number;
  portalId: string;
  /** What was searched: the date and what it means (see RunConfiguration). */
  searchKey: string;
  /** Only a search that finished replaces an earlier one. */
  finished: boolean;
  /** Document and change-check runs never replace a search. */
  isSearch: boolean;
}

/** The runs in one day folder that a later finished search of the same thing replaced. */
export function supersededRuns(runs: readonly DayFolderRun[]): Set<string> {
  const latestFinished = new Map<string, number>();
  for (const run of runs) {
    if (!run.isSearch || !run.finished) continue;
    const group = `${run.portalId}\u0000${run.searchKey}`;
    latestFinished.set(group, Math.max(latestFinished.get(group) ?? 0, run.runNumber));
  }
  const superseded = new Set<string>();
  for (const run of runs) {
    if (!run.isSearch) continue;
    const latest = latestFinished.get(`${run.portalId}\u0000${run.searchKey}`);
    if (latest !== undefined && run.runNumber < latest) superseded.add(run.jobId);
  }
  return superseded;
}
