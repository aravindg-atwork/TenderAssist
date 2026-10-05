// Pure sizing rules for the run workspace: an instruction panel beside the
// embedded portal. Kept free of DOM and Electron so it can be tested and
// reused; the renderer only measures and applies.

export type RunLayoutMode = 'split' | 'tabs';
export type RunFocusPreset = 'instructions' | 'balanced' | 'portal';

export const SPLIT_MIN_WINDOW_WIDTH = 1120;
export const MIN_GUIDE_WIDTH = 320;
export const MAX_GUIDE_WIDTH = 720;
export const MIN_PORTAL_WIDTH = 640;

const PRESET_RATIO: Record<RunFocusPreset, number> = {
  instructions: 0.6,
  balanced: 0.35,
  portal: 0.22,
};

export const RUN_FOCUS_PRESETS: readonly RunFocusPreset[] = ['instructions', 'balanced', 'portal'];

export function layoutModeFor(windowWidth: number): RunLayoutMode {
  return windowWidth >= SPLIT_MIN_WINDOW_WIDTH ? 'split' : 'tabs';
}

/** Keep the instruction panel within 320-720 px while leaving the portal at least 640 px. */
export function clampGuideWidth(width: number, containerWidth: number): number {
  const max = Math.min(MAX_GUIDE_WIDTH, containerWidth - MIN_PORTAL_WIDTH);
  return Math.round(Math.max(MIN_GUIDE_WIDTH, Math.min(width, max)));
}

export function guideWidthForPreset(preset: RunFocusPreset, containerWidth: number): number {
  return clampGuideWidth(containerWidth * PRESET_RATIO[preset], containerWidth);
}

/** The preset a width corresponds to, so the matching button shows as selected. */
export function presetForWidth(width: number, containerWidth: number): RunFocusPreset | null {
  return RUN_FOCUS_PRESETS.find((preset) => Math.abs(guideWidthForPreset(preset, containerWidth) - width) <= 8) ?? null;
}

interface FocusSignal {
  phase?: string;
  authStep?: string;
  jobState?: string;
}

/** Where the operator's attention belongs right now, for the optional automatic focus. */
export function suggestedFocus(update: FocusSignal | null): RunFocusPreset {
  if (!update) return 'balanced';
  if (update.phase === 'AUTH' && ['LOGIN_REQUIRED', 'CAPTCHA_REQUIRED', 'AUTH_ERROR', 'WAITING_FOR_AUTHENTICATION'].includes(update.authStep ?? '')) {
    return 'portal';
  }
  if (update.phase === 'AUTH' && ['DSC_READY', 'DSC_LAUNCHED'].includes(update.authStep ?? '')) return 'instructions';
  if (update.jobState === 'SESSION_EXPIRED') return 'instructions';
  return 'balanced';
}
