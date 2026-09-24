import type { TextSize } from '../../src/persistence/repositories/displaySettingsRepository';

const CACHE_KEY = 'tenderassist.textSize';

/** Text size scales the root font size; every type role is rem-based so layouts reflow instead of magnifying. */
export function applyTextSize(textSize: TextSize): void {
  document.documentElement.dataset.textSize = textSize.toLowerCase().replace('_', '-');
  try { localStorage.setItem(CACHE_KEY, textSize); } catch { /* the saved setting still applies after startup */ }
}

/** Apply the last-used size before first paint so text does not jump while settings load. */
export function applyCachedTextSize(): void {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached === 'STANDARD' || cached === 'LARGE' || cached === 'EXTRA_LARGE') applyTextSize(cached);
  } catch { /* fall back to Standard until settings load */ }
}
