export type PortalAuthIssueCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'PASSWORD_EXPIRED'
  | 'INVALID_CAPTCHA'
  | 'DSC_TOKEN_REQUIRED'
  | 'DSC_SIGNER_ERROR';

export interface PortalAuthIssue {
  code: PortalAuthIssueCode;
  message: string;
  recovery: string;
}

const ISSUE_PATTERNS: Array<{ pattern: RegExp; issue: PortalAuthIssue }> = [
  {
    pattern: /account\s+(?:is\s+)?locked|user\s+(?:is\s+)?locked|login\s+locked/i,
    issue: { code: 'ACCOUNT_LOCKED', message: 'The TN Tenders account is locked.', recovery: 'Use the portal account recovery process or contact the portal administrator before retrying.' },
  },
  {
    pattern: /password\s+(?:has\s+)?expired|change\s+your\s+password/i,
    issue: { code: 'PASSWORD_EXPIRED', message: 'The portal password has expired.', recovery: 'Change it in Chrome, then replace the saved password in TenderAssist Settings.' },
  },
  {
    pattern: /invalid\s+(?:login|user|username|password|credentials)|incorrect\s+(?:user|password|credentials)/i,
    issue: { code: 'INVALID_CREDENTIALS', message: 'The portal rejected the login ID or password.', recovery: 'Correct the credentials in Chrome, then update the saved login in Settings.' },
  },
  {
    pattern: /invalid\s+captcha|captcha\s+(?:is\s+)?(?:incorrect|invalid|mismatch)/i,
    issue: { code: 'INVALID_CAPTCHA', message: 'The CAPTCHA was not accepted.', recovery: 'Enter the new CAPTCHA shown in Chrome and select Proceed again.' },
  },
  {
    pattern: /(?:insert|connect).*?(?:dsc|token)|dsc.*?(?:not\s+found|not\s+connected)/i,
    issue: { code: 'DSC_TOKEN_REQUIRED', message: 'The DSC token was not detected.', recovery: 'Connect the token, wait for Windows to recognise it, and retry DSC Login.' },
  },
  {
    pattern: /(?:signer|jnlp|java\s+web\s+start).*?(?:failed|error|unable|not\s+found)/i,
    issue: { code: 'DSC_SIGNER_ERROR', message: 'The DSC signer could not start.', recovery: 'Confirm OpenWebStart or Java Web Start is installed and associated with .jnlp files, then download the signer again.' },
  },
];

export function detectPortalAuthIssue(pageText: string): PortalAuthIssue | null {
  for (const candidate of ISSUE_PATTERNS) {
    if (candidate.pattern.test(pageText)) return candidate.issue;
  }
  return null;
}

/** Generic DSC troubleshooting copy remains visible on the legacy portal
 * even while a real signer flow is progressing. Once that flow has started,
 * only non-DSC login errors should be promoted to the TenderAssist banner. */
export function shouldSurfacePortalAuthIssue(issue: PortalAuthIssue, dscFlowStarted: boolean): boolean {
  if (!dscFlowStarted) return true;
  return issue.code !== 'DSC_TOKEN_REQUIRED' && issue.code !== 'DSC_SIGNER_ERROR';
}
