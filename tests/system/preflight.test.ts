import { afterEach, describe, expect, it } from 'vitest';
import http, { type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreflight } from '../../src/system/preflight.js';

describe('runPreflight website check', () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); });

  it('asks like a browser, since GePNIC answers "Accept-Language: *" with a server error', async () => {
    // As Tamil Nadu did on 9 Oct 2026: 500 to Node's default "*", 200 to a real language.
    server = http.createServer((req, res) => {
      res.writeHead(req.headers['accept-language'] === '*' || !req.headers['accept-language'] ? 500 : 200);
      res.end('<html><body>eProcurement System</body></html>');
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const report = await runPreflight(mkdtempSync(join(tmpdir(), 'ta-preflight-')), `http://127.0.0.1:${port}/nicgep/app`, 'Tamil Nadu', '', null);

    expect(report.checks.find((check) => check.id === 'portal')).toMatchObject({ level: 'PASS', message: 'The website is answering.' });
  });
});
