import type { DatabaseSync } from 'node:sqlite';

const SETTINGS_KEY = 'display';

export type TextSize = 'STANDARD' | 'LARGE' | 'EXTRA_LARGE';

export const TEXT_SIZES: readonly TextSize[] = ['STANDARD', 'LARGE', 'EXTRA_LARGE'];
export const DEFAULT_PORTAL_ZOOM_PERCENT = 100;
export const MIN_PORTAL_ZOOM_PERCENT = 80;
export const MAX_PORTAL_ZOOM_PERCENT = 200;
export const PORTAL_ZOOM_STEP_PERCENT = 10;

interface DisplaySettings {
  textSize: TextSize;
  portalZoomPercent: Record<string, number>;
}

interface SettingsRow { value_json: string }

export function normalizePortalZoom(percent: number): number {
  const value = Number(percent);
  if (!Number.isFinite(value)) throw new Error('Portal zoom must be a number.');
  const stepped = Math.round(value / PORTAL_ZOOM_STEP_PERCENT) * PORTAL_ZOOM_STEP_PERCENT;
  return Math.min(MAX_PORTAL_ZOOM_PERCENT, Math.max(MIN_PORTAL_ZOOM_PERCENT, stepped));
}

export function stepPortalZoom(percent: number, direction: 1 | -1): number {
  return normalizePortalZoom(normalizePortalZoom(percent) + direction * PORTAL_ZOOM_STEP_PERCENT);
}

export class DisplaySettingsRepository {
  constructor(private db: DatabaseSync) {}

  getTextSize(): TextSize {
    return this.read().textSize;
  }

  saveTextSize(textSize: TextSize): TextSize {
    if (!TEXT_SIZES.includes(textSize)) throw new Error('Text size must be Standard, Large, or Extra large.');
    this.write({ ...this.read(), textSize });
    return textSize;
  }

  getPortalZoom(portalId: string): number {
    return this.read().portalZoomPercent[portalId] ?? DEFAULT_PORTAL_ZOOM_PERCENT;
  }

  savePortalZoom(portalId: string, percent: number): number {
    const next = normalizePortalZoom(percent);
    const current = this.read();
    this.write({ ...current, portalZoomPercent: { ...current.portalZoomPercent, [portalId]: next } });
    return next;
  }

  private read(): DisplaySettings {
    const fallback: DisplaySettings = { textSize: 'STANDARD', portalZoomPercent: {} };
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(SETTINGS_KEY) as SettingsRow | undefined;
    if (!row) return fallback;
    try {
      const parsed = JSON.parse(row.value_json) as Partial<DisplaySettings>;
      const textSize = TEXT_SIZES.includes(parsed.textSize as TextSize) ? parsed.textSize as TextSize : 'STANDARD';
      const portalZoomPercent: Record<string, number> = {};
      for (const [portalId, percent] of Object.entries(parsed.portalZoomPercent ?? {})) {
        if (Number.isFinite(Number(percent))) portalZoomPercent[portalId] = normalizePortalZoom(percent);
      }
      return { textSize, portalZoomPercent };
    } catch {
      return fallback;
    }
  }

  private write(settings: DisplaySettings): void {
    this.db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(SETTINGS_KEY, JSON.stringify(settings), new Date().toISOString());
  }
}
