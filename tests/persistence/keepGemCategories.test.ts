import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../../src/persistence/migrate.js';
import { RunConfigurationRepository } from '../../src/persistence/repositories/runConfigurationRepository.js';
import { categoriesForPortal, DEFAULT_GEM_CATEGORIES } from '../../src/config/runConfiguration.js';

const ALL = join(process.cwd(), 'src', 'persistence', 'migrations');
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A database as an install before 13 Oct 2026 left it: every migration up to 018. */
function before019(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), 'ta-migrations-'));
  dirs.push(dir);
  for (const file of readdirSync(ALL).filter((name) => name < '019')) copyFileSync(join(ALL, file), join(dir, file));
  const db = new DatabaseSync(':memory:');
  runMigrations(db, dir);
  return db;
}

describe('smaller starting lists never change an office already set up', () => {
  it('saves the old 10 GeM starting categories for settings that never chose their own', () => {
    const db = before019();
    const repo = new RunConfigurationRepository(db);
    // Saved by an earlier version: Tamil Nadu categories only, GeM on its starting list.
    repo.saveDefaults({ productCategories: ['Information Technology'], keywords: ['web application'], excludedKeywords: [], categoriesByPortal: { 'tamil-nadu': ['Information Technology'] }, gemIncludeProducts: false });
    runMigrations(db, ALL);
    const gem = categoriesForPortal(repo.getDefaults(), { id: 'gem', kind: 'GEM' });
    expect(gem).toHaveLength(10);
    expect(gem).toContain('Hiring Of Agency For It Projects- Milestone Basis');
    expect(repo.getDefaults().categoriesByPortal['tamil-nadu']).toEqual(['Information Technology']);
  });

  it('keeps GeM categories an office chose itself, and leaves a new install on the few examples', () => {
    const chosen = before019();
    const repo = new RunConfigurationRepository(chosen);
    repo.saveDefaults({ productCategories: ['IT'], keywords: ['a b'], excludedKeywords: [], categoriesByPortal: { gem: ['Custom Bid For Services'] }, gemIncludeProducts: false });
    runMigrations(chosen, ALL);
    expect(repo.getDefaults().categoriesByPortal.gem).toEqual(['Custom Bid For Services']);

    const fresh = new DatabaseSync(':memory:');
    runMigrations(fresh, ALL);
    const defaults = new RunConfigurationRepository(fresh).getDefaults();
    expect(categoriesForPortal(defaults, { id: 'gem', kind: 'GEM' })).toEqual([...DEFAULT_GEM_CATEGORIES]);
    expect(DEFAULT_GEM_CATEGORIES.length).toBeLessThanOrEqual(4);
    expect(defaults.keywords.length).toBeLessThanOrEqual(4);
    expect(defaults.excludedKeywords.length).toBeLessThanOrEqual(4);
  });
});
