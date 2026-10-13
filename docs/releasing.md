# Prod and dev: how new work reaches the office

Offices use TenderAssist every day, and it updates itself from this
repository's GitHub Releases. So new work is tried in a separate **dev build**
first, and only verified work becomes a release.

| | Prod (`main`) | Dev (`dev` branch) |
|---|---|---|
| Who has it | The offices, through automatic updates | Only us, on a test PC |
| What goes in | Verified work, merged from `dev` | Everything, while it is being built |
| Installer | `npm run dist:win` (CI on a `v*` tag) | `npm run dist:win:dev` → `release-dev/` |
| App | TenderAssist | **TenderAssist Dev** (amber DEV mark) |
| Updates | Automatic | None: install a newer dev build by hand |

## The dev build

`npm run dist:win:dev` makes `release-dev/TenderAssist-Dev-Setup-<version>.exe`
on this PC (unsigned; no GitHub involved). It installs **beside** the real app
(`build/electron-builder.dev.cjs`, `src/config/buildChannel.ts`):

- its own data folder `%APPDATA%\TenderAssist Dev` (database, key, DSC
  downloads) and reports folder `Documents\TenderAssist Dev`;
- its own shortcut, taskbar button and uninstall entry;
- no update feed: releases never replace it, and it never offers itself to anyone;
- it reads the shared GeM category lists but never sends its own, so work
  being tested cannot reach the offices;
- the same key server: activate it with a test key. Set its own Drive folder
  name in Settings, so test reports stay out of the office's Drive folder.

## Steps

1. Work on `dev`. Commit and push freely: nothing on `dev` reaches users.
2. Build the dev installer, install it on the test PC, and check the new work.
3. When it is verified, merge `dev` into `main` and bump the version.
4. **Only when the owner says deploy:** tag `main` (`vX.Y.Z`) and push the tag.
   CI builds, signs and publishes the release; the offices update within hours.

The release job refuses a tag that is not on `main`, so a tag on `dev` can never
publish. The licence server (`licence-server/Code.gs`) is deployed separately
and also only when the owner says so.
