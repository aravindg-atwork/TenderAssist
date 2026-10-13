// The dev build ("TenderAssist Dev", npm run dist:win:dev) installs beside the
// office's real app: its own data folder, Documents folder, taskbar ID and
// shortcut, and no automatic updates, so testing never touches real work and
// the published releases never replace it. The dev installer marks its
// package.json with "tenderassistChannel": "dev" (build/electron-builder.dev.cjs).

export type BuildChannel = 'prod' | 'dev';

export interface BuildIdentity {
  channel: BuildChannel;
  /** Folder name under APPDATA and Documents. */
  folderName: string;
  /** Windows taskbar ID; must equal the installer's appId. */
  appUserModelId: string;
}

export function buildIdentity(packageJson: { tenderassistChannel?: unknown }): BuildIdentity {
  return packageJson.tenderassistChannel === 'dev'
    ? { channel: 'dev', folderName: 'TenderAssist Dev', appUserModelId: 'in.tenderassist.desktop.dev' }
    : { channel: 'prod', folderName: 'TenderAssist', appUserModelId: 'in.tenderassist.desktop' };
}
