// The dev build: "TenderAssist Dev", for trying new work on a test PC before
// it goes to the office (npm run dist:win:dev). Same app as the real one, but
// it installs beside it with its own name, appId, shortcut and data folder
// (src/config/buildChannel.ts), and has no update feed: published releases
// never replace it and it never offers itself to anyone. Never published.
const pkg = require('../package.json');

const NAME = 'TenderAssist Dev';

module.exports = {
  ...pkg.build,
  appId: 'in.tenderassist.desktop.dev',
  productName: NAME,
  extraMetadata: { productName: NAME, tenderassistChannel: 'dev' },
  directories: { ...pkg.build.directories, output: 'release-dev' },
  publish: null,
  win: { ...pkg.build.win, artifactName: 'TenderAssist-Dev-Setup-${version}.${ext}' },
  nsis: { ...pkg.build.nsis, shortcutName: NAME },
};
