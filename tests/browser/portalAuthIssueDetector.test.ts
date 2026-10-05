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

describe('DSC page with a connected token', () => {
  it('does not report a missing token when the portal lists the certificate', () => {
    const page = [
      'Digital Certificate Authentication',
      '1. You have registered with DSC. Please insert your DSC card / e-Token for authentication.',
      'S.No Alias Name Serial No. Certificate Type Expiry Date Type Status',
      '1. KUMARAN 68 7e 6f 21 0f 6b Signing 03-Apr-2027 06:25 PM Class 3 Live',
      'DSC Login Logout',
      '6. Ensure that your DSC token is inserted into your computer.',
    ].join('\n');
    expect(detectPortalAuthIssue(page)).toBeNull();
  });

  it('still reports it when no certificate is listed', () => {
    expect(detectPortalAuthIssue('Please insert your DSC card / e-Token for authentication.')?.code).toBe('DSC_TOKEN_REQUIRED');
  });
});
