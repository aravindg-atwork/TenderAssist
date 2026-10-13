import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildIdentity } from '../../src/config/buildChannel.js';

const require = createRequire(import.meta.url);

describe('build channel', () => {
  it('is the real app unless the package says dev', () => {
    expect(buildIdentity({})).toMatchObject({ channel: 'prod', folderName: 'TenderAssist', appUserModelId: 'in.tenderassist.desktop' });
    expect(buildIdentity({ tenderassistChannel: 'dev' })).toMatchObject({ channel: 'dev', folderName: 'TenderAssist Dev' });
  });

  it('matches the installers: appId, name, and no update feed for dev', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(buildIdentity(pkg).appUserModelId).toBe(pkg.build.appId);
    expect(pkg.build.productName).toBe(buildIdentity(pkg).folderName);
    const dev = require('../../build/electron-builder.dev.cjs');
    expect(buildIdentity(dev.extraMetadata).appUserModelId).toBe(dev.appId);
    expect(dev.productName).toBe(buildIdentity(dev.extraMetadata).folderName);
    expect(dev.publish).toBeNull();
  });
});
