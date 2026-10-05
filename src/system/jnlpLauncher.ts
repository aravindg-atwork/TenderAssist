import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

// The DSC signer is a signData.jnlp file that only Java Web Start
// (OpenWebStart) can run. Without it, Windows shows an "open with" prompt
// or nothing at all, and sign-in stalls with no explanation, so the launcher
// is located up front and started directly.

export const OPENWEBSTART_DOWNLOAD_URL = 'https://openwebstart.com/download/';

export type JnlpLauncherStatus =
  /** A Java Web Start executable was found. */
  | 'READY'
  /** Nothing on this computer can open .jnlp files. */
  | 'MISSING'
  /** This platform's launcher cannot be checked; the OS file association is used. */
  | 'UNKNOWN';

export interface JnlpLauncher {
  status: JnlpLauncherStatus;
  executable?: string;
}

export const MISSING_SIGNER_MESSAGE =
  'OpenWebStart (Java) is not installed, so the DSC signer cannot open and sign-in cannot finish. Install OpenWebStart, then start the job again.';

/** The default value from `reg query <key> /ve` output, or null. */
export function parseRegDefaultValue(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*\((?:Default|default)\)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line);
    if (match) return match[1].trim() || null;
  }
  return null;
}

/** The ProgId from `reg query ...\UserChoice /v ProgId` output, or null. */
export function parseRegProgId(output: string): string | null {
  const match = /^\s*ProgId\s+REG_SZ\s+(.+)$/m.exec(output);
  return match ? match[1].trim() : null;
}

/** The executable path at the start of a shell open command such as `"C:\x\javaws.exe" "%1"`. */
export function executableFromCommand(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const trimmed = command.trim();
  const raw = trimmed.startsWith('"') ? /^"([^"]+)"/.exec(trimmed)?.[1] : /^(\S+?\.exe)\b/i.exec(trimmed)?.[1];
  if (!raw) return null;
  return raw.replace(/%([^%]+)%/g, (whole, name: string) => env[name] ?? env[name.toUpperCase()] ?? whole);
}

/** Where OpenWebStart installs javaws.exe for all users or the current user. */
export function knownWindowsLaunchers(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(
    (root): root is string => Boolean(root)
  );
  return roots.flatMap((root) => [join(root, 'OpenWebStart', 'javaws.exe'), join(root, 'Open WebStart', 'javaws.exe')]);
}

function regQuery(args: string[]): string {
  try {
    return execFileSync('reg.exe', ['query', ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function registeredWindowsLauncher(): string | null {
  const progIds = [
    parseRegProgId(regQuery(['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.jnlp\\UserChoice', '/v', 'ProgId'])),
    parseRegDefaultValue(regQuery(['HKCR\\.jnlp', '/ve'])),
  ].filter((value): value is string => Boolean(value));
  for (const progId of progIds) {
    const command = parseRegDefaultValue(regQuery([`HKCR\\${progId}\\shell\\open\\command`, '/ve']));
    const executable = command ? executableFromCommand(command) : null;
    // A .jnlp opened in Notepad or a browser is not a signer.
    if (executable && /javaws|jp2launcher/i.test(basename(executable)) && existsSync(executable)) return executable;
  }
  return null;
}

export function detectJnlpLauncher(platform: NodeJS.Platform = process.platform): JnlpLauncher {
  if (platform !== 'win32') return { status: 'UNKNOWN' };
  const executable = registeredWindowsLauncher() ?? knownWindowsLaunchers().find((path) => existsSync(path));
  return executable ? { status: 'READY', executable } : { status: 'MISSING' };
}
