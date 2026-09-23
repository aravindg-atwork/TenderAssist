import { describe, expect, it } from 'vitest';
import { detectPortalAuthIssue, shouldSurfacePortalAuthIssue } from '../../src/browser/portalAuthIssueDetector.js';

describe('detectPortalAuthIssue', () => {
  it.each([
    ['Your account is locked', 'ACCOUNT_LOCKED'],
    ['Password has expired', 'PASSWORD_EXPIRED'],
    ['Invalid username or password', 'INVALID_CREDENTIALS'],
    ['Captcha is incorrect', 'INVALID_CAPTCHA'],
    ['Please connect your DSC token', 'DSC_TOKEN_REQUIRED'],
    ['JNLP signer failed to launch', 'DSC_SIGNER_ERROR'],
  ])('detects %s', (text, code) => {
    expect(detectPortalAuthIssue(text)?.code).toBe(code);
  });

  it('returns null for ordinary portal content', () => {
    expect(detectPortalAuthIssue('Welcome to the eProcurement portal')).toBeNull();
  });

  it('does not replace an active DSC flow with generic DSC troubleshooting copy', () => {
    const issue = detectPortalAuthIssue('Please connect your DSC token');
    expect(issue).not.toBeNull();
    expect(shouldSurfacePortalAuthIssue(issue!, true)).toBe(false);
    expect(shouldSurfacePortalAuthIssue(issue!, false)).toBe(true);
  });
});
