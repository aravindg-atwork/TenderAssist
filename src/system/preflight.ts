import { accessSync, constants, mkdirSync } from 'node:fs';
import { detectJnlpLauncher, MISSING_SIGNER_MESSAGE, OPENWEBSTART_DOWNLOAD_URL, type JnlpLauncher } from './jnlpLauncher.js';

// Asked the way a browser asks. Node's fetch sends "Accept-Language: *",
// which NIC's GePNIC websites answer with a server error (500) even while
// they work for everyone else -- seen on Tamil Nadu, 9 Oct 2026 -- so the
// check said "having trouble" for a website that was fine.
export const PORTAL_CHECK_HEADERS: Readonly<Record<string, string>> = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-IN,en;q=0.9',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 TenderAssist',
};

export type PreflightLevel = 'PASS' | 'WARNING' | 'BLOCKED';
export interface PreflightCheck {
  id: string;
  label: string;
  level: PreflightLevel;
  message: string;
  /** A page that fixes the problem, such as an installer download. */
  helpUrl?: string;
}
export interface PreflightReport { ready: boolean; checks: PreflightCheck[] }

export async function runPreflight(
  outputRoot: string,
  portalUrl: string,
  portalLabel = 'Selected portal',
  driveOutputRoot = '',
  /** Null for websites searched without signing in (GeM): no browser sign-in, no DSC signer. */
  detectSigner: (() => JnlpLauncher) | null = detectJnlpLauncher
): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  if (detectSigner) {
    checks.push({ id: 'browser', label: 'Embedded browser', level: 'PASS', message: `The secure ${portalLabel} browser is included with TenderAssist.` });
  }

  try {
    mkdirSync(outputRoot, { recursive: true });
    accessSync(outputRoot, constants.W_OK);
    checks.push({ id: 'output', label: 'Publishing folder', level: 'PASS', message: 'The output folder is writable.' });
  } catch {
    checks.push({ id: 'output', label: 'Publishing folder', level: 'BLOCKED', message: 'Choose a writable publishing folder in Settings.' });
  }

  if (driveOutputRoot.trim()) {
    try {
      mkdirSync(driveOutputRoot, { recursive: true });
      accessSync(driveOutputRoot, constants.W_OK);
      checks.push({ id: 'drive-output', label: 'Drive copy folder', level: 'PASS', message: 'The Drive copy folder is writable.' });
    } catch {
      checks.push({ id: 'drive-output', label: 'Drive copy folder', level: 'BLOCKED', message: 'Choose a writable Drive sync folder or clear the optional Drive path.' });
    }
  }

  try {
    const response = await fetch(portalUrl, { headers: PORTAL_CHECK_HEADERS, signal: AbortSignal.timeout(7000) });
    checks.push({ id: 'portal', label: portalLabel, level: response.ok ? 'PASS' : 'WARNING', message: response.ok ? 'The website is answering.' : 'The website is having trouble right now. You can still search; TenderAssist waits and tries again.' });
  } catch {
    checks.push({ id: 'portal', label: portalLabel, level: 'WARNING', message: 'The website could not be reached. Check the internet connection, or try again in a few minutes.' });
  }

  const signer = detectSigner?.() ?? null;
  if (!signer) {
    // Nothing to sign in with.
  } else if (signer.status === 'READY') {
    checks.push({ id: 'jnlp', label: 'DSC signer (OpenWebStart)', level: 'PASS', message: 'Java Web Start is installed for the DSC signer.' });
  } else if (signer.status === 'MISSING') {
    // Sign-in cannot finish without the signer, so the run must not start.
    checks.push({ id: 'jnlp', label: 'DSC signer (OpenWebStart)', level: 'BLOCKED', message: MISSING_SIGNER_MESSAGE, helpUrl: OPENWEBSTART_DOWNLOAD_URL });
  }

  return { ready: checks.every((check) => check.level !== 'BLOCKED'), checks };
}
