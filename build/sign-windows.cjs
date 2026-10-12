// Signs each Windows .exe electron-builder makes (the app, the installer, the
// uninstaller) with the company's code signing certificate, held in SSL.com's
// cloud (eSigner), so Windows shows the company as the publisher instead of
// "Unknown publisher". Signing happens inside the build, before the update
// file (latest.yml) records the installer's checksum, so automatic updates
// still match. Setup: docs/code-signing.md.
//
// Needs, from the environment (GitHub secrets in CI):
//   ESIGNER_USERNAME, ESIGNER_PASSWORD, ESIGNER_CREDENTIAL_ID, ESIGNER_TOTP_SECRET
//   CODESIGNTOOL_DIR  the folder of SSL.com's CodeSignTool
// Without them the build is left unsigned, unless REQUIRE_SIGNING=true (release builds).

const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const NEEDED = ['ESIGNER_USERNAME', 'ESIGNER_PASSWORD', 'ESIGNER_CREDENTIAL_ID', 'ESIGNER_TOTP_SECRET', 'CODESIGNTOOL_DIR'];

exports.default = async function sign(configuration) {
  const file = configuration.path;
  const missing = NEEDED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    if (process.env.REQUIRE_SIGNING === 'true') {
      throw new Error(`Code signing is required for this build, but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set (docs/code-signing.md).`);
    }
    console.log(`  • not signed (no code signing set up): ${file}`);
    return;
  }
  // CodeSignTool is a Java program; run it directly, not through its .bat,
  // so a password with & or % is passed as it is (no shell in between).
  const dir = process.env.CODESIGNTOOL_DIR;
  const jarDir = join(dir, 'jar');
  const jar = existsSync(jarDir) && readdirSync(jarDir).find((name) => /^code_sign_tool.*\.jar$/i.test(name));
  if (!jar) throw new Error(`CodeSignTool was not found in ${dir} (expected jar/code_sign_tool-*.jar).`);
  // The Windows zip carries its own Java (jdk-*); use it, else the machine's.
  const bundled = readdirSync(dir).find((name) => /^jdk/i.test(name) && existsSync(join(dir, name, 'bin', 'java.exe')));
  const java = bundled ? join(dir, bundled, 'bin', 'java.exe') : process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
  console.log(`  • signing ${file}`);
  // -override signs the file in place. Output is CodeSignTool's own (it never prints the secrets).
  execFileSync(java, [
    '-jar', join(jarDir, jar),
    'sign',
    `-username=${process.env.ESIGNER_USERNAME}`,
    `-password=${process.env.ESIGNER_PASSWORD}`,
    `-credential_id=${process.env.ESIGNER_CREDENTIAL_ID}`,
    `-totp_secret=${process.env.ESIGNER_TOTP_SECRET}`,
    `-input_file_path=${file}`,
    '-override',
  ], { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
};
