import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeDscDownload, isTrustedDscDownload } from '../../src/browser/dscDownloadSecurity.js';

describe('DSC download security', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('accepts only TN Tenders HTTPS signData JNLP downloads', () => {
    expect(isTrustedDscDownload({
      sourceUrl: 'https://tntenders.gov.in/nicgep/FrontEndFileDownloadServlet?id=1',
      suggestedFilename: 'signData.jnlp',
    })).toBe(true);
    expect(isTrustedDscDownload({
      sourceUrl: 'https://evil.example/signData.jnlp',
      suggestedFilename: 'signData.jnlp',
    })).toBe(false);
    expect(isTrustedDscDownload({
      sourceUrl: 'http://tntenders.gov.in/nicgep/signData.jnlp',
      suggestedFilename: 'signData.jnlp',
    })).toBe(false);
  });

  it('renames a valid completed GUID download to a readable JNLP file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tenderassist-dsc-test-'));
    dirs.push(dir);
    const guidPath = join(dir, 'download-guid');
    writeFileSync(guidPath, '<?xml version="1.0"?><jnlp spec="1.0+"></jnlp>');

    const artifact = finalizeDscDownload(guidPath, dir, {
      sourceUrl: 'https://www.tntenders.gov.in/nicgep/FrontEndFileDownloadServlet?id=1',
      suggestedFilename: 'signData (1).jnlp',
    });

    expect(artifact?.fileName).toMatch(/^signData-.+\.jnlp$/);
    expect(readFileSync(artifact!.filePath, 'utf8')).toContain('<jnlp');
  });
});
