// Stops an installer build that would lock every customer out: the app checks
// its key against LICENCE_SERVER_URL, and the installer's key page uses the
// same address. Run by `npm run dist:win` / `dist:mac` before electron-builder.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const app = /LICENCE_SERVER_URL = '([^']*)'/.exec(readFileSync(join(root, 'src', 'licence', 'licenceServer.ts'), 'utf8'))?.[1] ?? '';
const installer = /!define LICENCE_SERVER_URL "([^"]*)"/.exec(readFileSync(join(root, 'build', 'installer.nsh'), 'utf8'))?.[1] ?? '';

if (!app.startsWith('https://')) {
  console.error('No licence key server set: put the Apps Script /exec URL in src/licence/licenceServer.ts and build/installer.nsh (docs/licence-setup.md).');
  process.exit(1);
}
if (app !== installer) {
  console.error(`The installer's key server (${installer || 'none'}) differs from the app's (${app}). Make build/installer.nsh match src/licence/licenceServer.ts.`);
  process.exit(1);
}
console.log(`Licence key server: ${app}`);
