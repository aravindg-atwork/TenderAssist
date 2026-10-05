import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executableFromCommand,
  knownWindowsLaunchers,
  MISSING_SIGNER_MESSAGE,
  OPENWEBSTART_DOWNLOAD_URL,
  parseRegDefaultValue,
  parseRegProgId,
} from '../../src/system/jnlpLauncher.js';
import { runPreflight } from '../../src/system/preflight.js';

describe('DSC signer launcher detection', () => {
  it('reads the default value and ProgId from reg query output', () => {
    const progId = '\r\nHKEY_CLASSES_ROOT\\.jnlp\r\n    (Default)    REG_SZ    JNLPFile\r\n\r\n';
    expect(parseRegDefaultValue(progId)).toBe('JNLPFile');
    expect(parseRegDefaultValue('\r\nHKEY_CLASSES_ROOT\\.jnlp\r\n    (Default)    REG_SZ    \r\n')).toBeNull();
    expect(parseRegDefaultValue('')).toBeNull();
    const userChoice = '\r\nHKEY_CURRENT_USER\\...\\UserChoice\r\n    ProgId    REG_SZ    OpenWebStart.jnlp\r\n';
    expect(parseRegProgId(userChoice)).toBe('OpenWebStart.jnlp');
  });

  it('takes the executable from a shell open command', () => {
    expect(executableFromCommand('"C:\\Program Files\\OpenWebStart\\javaws.exe" "%1"')).toBe('C:\\Program Files\\OpenWebStart\\javaws.exe');
    expect(executableFromCommand('C:\\OWS\\javaws.exe "%1"')).toBe('C:\\OWS\\javaws.exe');
    expect(executableFromCommand('"%LOCALAPPDATA%\\Programs\\OpenWebStart\\javaws.exe" "%1"', { LOCALAPPDATA: 'C:\\Users\\op\\AppData\\Local' }))
      .toBe('C:\\Users\\op\\AppData\\Local\\Programs\\OpenWebStart\\javaws.exe');
    expect(executableFromCommand('')).toBeNull();
  });

  it('knows the all-users and per-user OpenWebStart install folders', () => {
    const paths = knownWindowsLaunchers({ ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\op\\AppData\\Local' });
    expect(paths).toContain(join('C:\\Program Files', 'OpenWebStart', 'javaws.exe'));
    expect(paths).toContain(join('C:\\Users\\op\\AppData\\Local', 'Programs', 'OpenWebStart', 'javaws.exe'));
  });
});

describe('readiness check for the DSC signer', () => {
  const outputRoot = () => mkdtempSync(join(tmpdir(), 'tenderassist-preflight-'));
  // An unreachable portal keeps the test offline; it is only a warning.
  const portalUrl = 'https://127.0.0.1:9/nicgep/app';

  it('blocks the run with install guidance when OpenWebStart is missing', async () => {
    const report = await runPreflight(outputRoot(), portalUrl, 'Test portal', '', () => ({ status: 'MISSING' }));
    const signer = report.checks.find((check) => check.id === 'jnlp');
    expect(report.ready).toBe(false);
    expect(signer).toMatchObject({ level: 'BLOCKED', message: MISSING_SIGNER_MESSAGE, helpUrl: OPENWEBSTART_DOWNLOAD_URL });
  });

  it('passes when the signer is installed, and stays silent where it cannot be checked', async () => {
    const ready = await runPreflight(outputRoot(), portalUrl, 'Test portal', '', () => ({ status: 'READY', executable: 'javaws.exe' }));
    expect(ready.checks.find((check) => check.id === 'jnlp')?.level).toBe('PASS');
    const unknown = await runPreflight(outputRoot(), portalUrl, 'Test portal', '', () => ({ status: 'UNKNOWN' }));
    expect(unknown.checks.find((check) => check.id === 'jnlp')).toBeUndefined();
    expect(unknown.ready).toBe(true);
  });
});
