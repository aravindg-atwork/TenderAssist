import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import {
  DEFAULT_PORTAL_ZOOM_PERCENT,
  DisplaySettingsRepository,
  stepPortalZoom,
} from '../../../src/persistence/repositories/displaySettingsRepository.js';

describe('DisplaySettingsRepository', () => {
  let db: DatabaseSync;
  let repo: DisplaySettingsRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new DisplaySettingsRepository(db);
  });

  it('defaults to standard text and 100% portal zoom', () => {
    expect(repo.getTextSize()).toBe('STANDARD');
    expect(repo.getPortalZoom('tn')).toBe(DEFAULT_PORTAL_ZOOM_PERCENT);
  });

  it('persists the text size', () => {
    expect(repo.saveTextSize('EXTRA_LARGE')).toBe('EXTRA_LARGE');
    expect(new DisplaySettingsRepository(db).getTextSize()).toBe('EXTRA_LARGE');
  });

  it('rejects an unknown text size', () => {
    expect(() => repo.saveTextSize('HUGE' as never)).toThrow('Text size');
  });

  it('remembers portal zoom separately for each portal', () => {
    repo.savePortalZoom('tn', 150);
    repo.savePortalZoom('kerala', 90);
    expect(repo.getPortalZoom('tn')).toBe(150);
    expect(repo.getPortalZoom('kerala')).toBe(90);
    expect(repo.getPortalZoom('goa')).toBe(100);
  });

  it('keeps the text size when portal zoom changes', () => {
    repo.saveTextSize('LARGE');
    repo.savePortalZoom('tn', 120);
    expect(repo.getTextSize()).toBe('LARGE');
  });

  it('clamps portal zoom to 80-200% in 10% steps', () => {
    expect(repo.savePortalZoom('tn', 40)).toBe(80);
    expect(repo.savePortalZoom('tn', 260)).toBe(200);
    expect(repo.savePortalZoom('tn', 124)).toBe(120);
    expect(() => repo.savePortalZoom('tn', Number.NaN)).toThrow('Portal zoom');
  });

  it('falls back to defaults when the stored value is corrupt', () => {
    db.prepare("INSERT INTO app_settings (key, value_json, updated_at) VALUES ('display', 'nope', '')").run();
    expect(repo.getTextSize()).toBe('STANDARD');
    expect(repo.getPortalZoom('tn')).toBe(100);
  });
});

describe('stepPortalZoom', () => {
  it('moves one 10% step and stops at the limits', () => {
    expect(stepPortalZoom(100, 1)).toBe(110);
    expect(stepPortalZoom(100, -1)).toBe(90);
    expect(stepPortalZoom(200, 1)).toBe(200);
    expect(stepPortalZoom(80, -1)).toBe(80);
  });
});
