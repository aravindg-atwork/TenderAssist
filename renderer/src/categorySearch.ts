/**
 * GeM names run to hundreds of characters ("E-learning Content Development -
 * Non-igot; Restructure …; Hindi, English, …"). The part before the first
 * " - " or ";" is the name a person scans for; the rest is shown smaller.
 */
export function splitCategory(value: string): { name: string; detail: string } {
  const match = /^(.{3,90}?)(?:\s+-\s+|;\s*)(.+)$/.exec(value);
  return match ? { name: match[1].trim(), detail: match[2].trim() } : { name: value, detail: '' };
}

/**
 * How well a category matches what was typed; lower is better, null is no
 * match. Every word typed must appear, in any order. The name before " - "
 * counts above the example after it.
 */
export function matchRank(option: string, query: string): number | null {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const whole = option.toLocaleLowerCase();
  if (!words.every((word) => whole.includes(word))) return null;
  const name = splitCategory(option).name.toLocaleLowerCase();
  const phrase = words.join(' ');
  if (name.startsWith(phrase)) return 0;
  if (name.includes(phrase)) return 1;
  if (words.every((word) => name.includes(word))) return 2;
  return 3;
}

/** The categories matching a search, best first, then in the website's own order. */
export function rankCategories(options: readonly string[], query: string, keep: (option: string) => boolean = () => true): string[] {
  const ranked: Array<{ option: string; rank: number; index: number }> = [];
  options.forEach((option, index) => {
    if (!keep(option)) return;
    const rank = matchRank(option, query);
    if (rank !== null) ranked.push({ option, rank, index });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((entry) => entry.option);
}
