import { accessSync, constants, mkdirSync } from 'node:fs';
import { detectJnlpLauncher, MISSING_SIGNER_MESSAGE, OPENWEBSTART_DOWNLOAD_URL, type JnlpLauncher } from './jnlpLauncher.js';

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
  detectSigner: () => JnlpLauncher = detectJnlpLauncher
): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  checks.push({ id: 'browser', label: 'Embedded browser', level: 'PASS', message: `The secure ${portalLabel} browser is included with TenderAssist.` });

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
    const response = await fetch(portalUrl, { signal: AbortSignal.timeout(7000) });
    checks.push({ id: 'portal', label: portalLabel, level: response.ok ? 'PASS' : 'WARNING', message: response.ok ? 'The website is answering.' : 'The website is having trouble right now. You can still search; TenderAssist waits and tries again.' });
  } catch {
    checks.push({ id: 'portal', label: portalLabel, level: 'WARNING', message: 'The website could not be reached. Check the internet connection, or try again in a few minutes.' });
  }

  const signer = detectSigner();
  if (signer.status === 'READY') {
    checks.push({ id: 'jnlp', label: 'DSC signer (OpenWebStart)', level: 'PASS', message: 'Java Web Start is installed for the DSC signer.' });
  } else if (signer.status === 'MISSING') {
    // Sign-in cannot finish without the signer, so the run must not start.
    checks.push({ id: 'jnlp', label: 'DSC signer (OpenWebStart)', level: 'BLOCKED', message: MISSING_SIGNER_MESSAGE, helpUrl: OPENWEBSTART_DOWNLOAD_URL });
  }

  return { ready: checks.every((check) => check.level !== 'BLOCKED'), checks };
}
