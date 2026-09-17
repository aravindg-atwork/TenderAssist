import { describe, it, expect } from 'vitest';
import { isAuthenticatedDashboard } from '../../src/browser/authDetector.js';

describe('isAuthenticatedDashboard', () => {
  it('returns true when all three indicators are present', () => {
    const pageText = `
      Welcome : contractor@example.com
      Home | Bid Management | My Account | Logout
    `;
    expect(isAuthenticatedDashboard(pageText)).toBe(true);
  });

  it('returns false when Welcome is missing', () => {
    const pageText = 'Home | Bid Management | My Account | Logout';
    expect(isAuthenticatedDashboard(pageText)).toBe(false);
  });

  it('returns false when Logout is missing', () => {
    const pageText = 'Welcome : contractor@example.com\nHome | Bid Management | My Account';
    expect(isAuthenticatedDashboard(pageText)).toBe(false);
  });

  it('returns false when Bid Management is missing', () => {
    const pageText = 'Welcome : contractor@example.com\nHome | My Account | Logout';
    expect(isAuthenticatedDashboard(pageText)).toBe(false);
  });

  it('returns false for an empty page', () => {
    expect(isAuthenticatedDashboard('')).toBe(false);
  });

  it('returns false for the pre-login page (only a login form)', () => {
    const pageText = 'User Login\nUsername\nPassword\nLogin with DSC';
    expect(isAuthenticatedDashboard(pageText)).toBe(false);
  });
});
