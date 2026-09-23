import { accessSync, constants, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export type PreflightLevel = 'PASS' | 'WARNING' | 'BLOCKED';
export interface PreflightCheck { id: string; label: string; level: PreflightLevel; message: string }
export interface PreflightReport { ready: boolean; checks: PreflightCheck[] }

export async function runPreflight(
  outputRoot: string,
  portalUrl: string,
  portalLabel = 'Selected portal',
  driveOutputRoot = ''
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
    checks.push({ id: 'portal', label: portalLabel, level: response.ok ? 'PASS' : 'WARNING', message: response.ok ? 'Portal is reachable.' : `Portal returned HTTP ${response.status}.` });
  } catch {
    checks.push({ id: 'portal', label: portalLabel, level: 'WARNING', message: 'Portal reachability could not be confirmed. You can retry when the network is available.' });
  }

  if (process.platform === 'win32') {
    try {
      const association = execFileSync('cmd.exe', ['/d', '/s', '/c', 'assoc .jnlp'], { encoding: 'utf8', windowsHide: true }).trim();
      checks.push({ id: 'jnlp', label: 'DSC signer', level: association.includes('=') ? 'PASS' : 'WARNING', message: association.includes('=') ? '.jnlp files have a registered application.' : 'Install OpenWebStart or associate .jnlp files before DSC login.' });
    } catch {
      checks.push({ id: 'jnlp', label: 'DSC signer', level: 'WARNING', message: 'No .jnlp file association was found. Install OpenWebStart before DSC login.' });
    }
  }

  return { ready: checks.every((check) => check.level !== 'BLOCKED'), checks };
}
