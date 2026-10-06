import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Electron throws at startup when a channel gets a second handler, and the
// window never opens. Check the source, since main.ts cannot load in a test.
const main = readFileSync(join(process.cwd(), 'src', 'electron', 'main.ts'), 'utf8');
const preload = readFileSync(join(process.cwd(), 'src', 'electron', 'preload.cts'), 'utf8');
const handled = [...main.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((match) => match[1]);

describe('IPC channels', () => {
  it('registers each handler only once', () => {
    const repeated = handled.filter((channel, index) => handled.indexOf(channel) !== index);
    expect(repeated).toEqual([]);
  });

  it('has a handler for every channel the renderer invokes', () => {
    const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1]);
    expect(invoked.filter((channel) => !handled.includes(channel))).toEqual([]);
  });
});
