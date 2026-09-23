import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from '../../../src/persistence/migrate.js';
import { PortalCredentialRepository } from '../../../src/persistence/repositories/portalCredentialRepository.js';

describe('PortalCredentialRepository', () => {
  let repo: PortalCredentialRepository;

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, join(process.cwd(), 'src', 'persistence', 'migrations'));
    repo = new PortalCredentialRepository(db);
  });

  it('returns an empty, password-free state initially', () => {
    expect(repo.get()).toEqual({ loginId: '', encryptedPasswordBase64: null });
  });

  it('stores only the encrypted password payload supplied by the main process', () => {
    repo.save({ loginId: ' bidder@example.com ', encryptedPasswordBase64: 'encrypted-base64' });
    expect(repo.get()).toEqual({
      loginId: 'bidder@example.com',
      encryptedPasswordBase64: 'encrypted-base64',
    });
  });

  it('forgets the password without deleting the login ID', () => {
    repo.save({ loginId: 'bidder@example.com', encryptedPasswordBase64: 'encrypted-base64' });
    expect(repo.forgetPassword()).toEqual({
      loginId: 'bidder@example.com',
      encryptedPasswordBase64: null,
    });
  });

  it('isolates credentials by portal', () => {
    repo.save({ loginId: 'tn-user', encryptedPasswordBase64: 'tn-secret' }, 'tamil-nadu');
    repo.save({ loginId: 'kerala-user', encryptedPasswordBase64: 'kerala-secret' }, 'kerala');
    expect(repo.get('tamil-nadu').loginId).toBe('tn-user');
    expect(repo.get('kerala').loginId).toBe('kerala-user');
  });
});
