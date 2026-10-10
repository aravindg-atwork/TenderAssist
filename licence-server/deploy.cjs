// Puts the licence server into Google and wires its URL into the app.
//
//   node licence-server/deploy.cjs
//
// Needs, once: the Apps Script API switched on (script.google.com/home/usersettings)
// and `npx @google/clasp login` with the company Google account.
//
// First run: makes the "TenderAssist Licences" sheet with this script bound to
// it, uploads it, and publishes the web app. Later runs: upload and publish a
// new version on the SAME deployment, so installed apps keep their URL.
// The private key goes up as Secret.gs from licence-server/secret/ (never in git).
// Working files live in licence-server/secret/deploy/ (.clasp.json, deployment id).

const { spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const root = join(here, '..');
const work = join(here, 'secret', 'deploy');
const idFile = join(work, 'deployment-id.txt');

function clasp(args) {
  const result = spawnSync('npx', ['--yes', '@google/clasp@2.4.2', ...args], { cwd: work, shell: true, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    console.error(output);
    throw new Error(`clasp ${args[0]} failed`);
  }
  return output;
}

mkdirSync(work, { recursive: true });
for (const file of ['Code.gs', 'NewKey.html', 'appsscript.json']) copyFileSync(join(here, file), join(work, file));
const pem = readFileSync(join(here, 'secret', 'private-key.pem'), 'utf8').trim();
writeFileSync(join(work, 'Secret.gs'), `// The licence signing key. Uploaded by deploy.cjs; never commit.\nvar LICENCE_PRIVATE_KEY = ${JSON.stringify(pem)};\n`);

if (!existsSync(join(work, '.clasp.json'))) {
  console.log('Making the "TenderAssist Licences" sheet…');
  console.log(clasp(['create', '--type', 'sheets', '--title', '"TenderAssist Licences"', '--rootDir', '.']).trim());
  // create writes its own appsscript.json; ours (scopes, web app access) wins.
  copyFileSync(join(here, 'appsscript.json'), join(work, 'appsscript.json'));
}

console.log('Uploading the script…');
clasp(['push', '--force']);

const existing = existsSync(idFile) ? readFileSync(idFile, 'utf8').trim() : '';
console.log(existing ? 'Publishing a new version on the same URL…' : 'Publishing the web app…');
const deployed = clasp(existing
  ? ['deploy', '--deploymentId', existing, '--description', `"${new Date().toISOString().slice(0, 16)}"`]
  : ['deploy', '--description', '"Licence server"']);
const id = existing || /- (AKfy[\w-]+) @/.exec(deployed)?.[1] || /(AKfy[\w-]+)/.exec(deployed)?.[1];
if (!id) throw new Error(`Could not read the deployment id from:\n${deployed}`);
writeFileSync(idFile, id);
const url = `https://script.google.com/macros/s/${id}/exec`;

const serverTs = join(root, 'src', 'licence', 'licenceServer.ts');
writeFileSync(serverTs, readFileSync(serverTs, 'utf8').replace(/LICENCE_SERVER_URL = '[^']*'/, `LICENCE_SERVER_URL = '${url}'`));
const nsh = join(root, 'build', 'installer.nsh');
writeFileSync(nsh, readFileSync(nsh, 'utf8').replace(/!define LICENCE_SERVER_URL "[^"]*"/, `!define LICENCE_SERVER_URL "${url}"`));

const sheet = JSON.parse(readFileSync(join(work, '.clasp.json'), 'utf8')).parentId;
console.log(`\nWeb app URL: ${url}`);
if (sheet) console.log(`Sheet: https://docs.google.com/spreadsheets/d/${Array.isArray(sheet) ? sheet[0] : sheet}/edit`);
console.log('The URL is now in src/licence/licenceServer.ts and build/installer.nsh.');
