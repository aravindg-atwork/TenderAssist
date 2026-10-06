import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { PortalCategoryRepository } from '../../../src/persistence/repositories/portalCategoryRepository.js';

describe('PortalCategoryRepository', () => {
  let repo: PortalCategoryRepository;

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new PortalCategoryRepository(db);
  });

  it('has no list before the first search', () => {
    expect(repo.get('tamil-nadu')).toEqual({ categories: [], readAt: null });
  });

  it('saves the list per website, in the website order, without repeats', () => {
    repo.save('tamil-nadu', ['Computer- S/W', '  Information  Technology ', 'Computer- S/W'], '2026-10-06T10:00:00.000Z');
    expect(repo.get('tamil-nadu')).toEqual({
      categories: ['Computer- S/W', 'Information Technology'],
      readAt: '2026-10-06T10:00:00.000Z',
    });
    expect(repo.get('kerala').categories).toEqual([]);
  });

  it('keeps the last good list when a search reads an empty one', () => {
    repo.save('tamil-nadu', ['Computer- S/W'], '2026-10-06T10:00:00.000Z');
    repo.save('tamil-nadu', [], '2026-10-07T10:00:00.000Z');
    expect(repo.get('tamil-nadu').categories).toEqual(['Computer- S/W']);
  });
});
