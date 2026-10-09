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
    expect(repo.get('tamil-nadu')).toMatchObject({
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

  it('remembers when each category was first and last on the list', () => {
    repo.save('tamil-nadu', ['Computer- S/W', 'Information Technology'], '2026-10-08T04:00:00.000Z');
    repo.save('tamil-nadu', ['Computer- S/W'], '2026-10-09T04:00:00.000Z');
    const list = repo.get('tamil-nadu');
    expect(list.historySince).toBe('2026-10-08T04:00:00.000Z');
    expect(list.history).toEqual({
      'computer- s/w': { firstSeen: '2026-10-08T04:00:00.000Z', lastSeen: '2026-10-09T04:00:00.000Z' },
      'information technology': { firstSeen: '2026-10-08T04:00:00.000Z', lastSeen: '2026-10-08T04:00:00.000Z' },
    });
  });

  it('remembers when the operator looked at the new categories, and keeps it across reads', () => {
    repo.save('tamil-nadu', ['Computer- S/W'], '2026-10-08T04:00:00.000Z');
    repo.markNewLooked('tamil-nadu', '2026-10-09T05:00:00.000Z');
    repo.save('tamil-nadu', ['Computer- S/W', 'UPS'], '2026-10-10T04:00:00.000Z');
    expect(repo.get('tamil-nadu').newLookedAt).toBe('2026-10-09T05:00:00.000Z');
  });
});
