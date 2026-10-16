// Choosing the Drive upload folder with Google's own folder chooser (the
// Google Picker), opened in the operator's browser from a page served on this
// computer only. TenderAssist signs in with the drive.file scope, so it sees
// only folders it made, or ones the operator picks here: a folder in My
// Drive, one shared with them, or one in a shared drive (operator, 16 Oct
// 2026: not everyone uploads to My Drive). Picking grants TenderAssist that
// folder alone.

import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { GoogleDriveError } from './googleDrive.js';

export interface PickedFolder {
  id: string;
  name: string;
}

export interface PickerPageInput {
  apiKey: string;
  /** The Google Cloud project number: the start of the OAuth client id. */
  appId: string;
  accessToken: string;
  /** Where the page sends the choice ("/<nonce>"). */
  answerPath: string;
}

/** The project number Google gives a client id ("859686513069-….apps.googleusercontent.com"). */
export function projectNumberOf(clientId: string): string {
  return /^(\d+)-/.exec(clientId)?.[1] ?? '';
}

// For values written into the page's script: JSON, with "<" escaped so no value can end the script.
const scriptValue = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c');

/** The page that opens Google's folder chooser and sends the chosen folder back. */
export function pickerPage(input: PickerPageInput): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Choose the TenderAssist folder</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;padding:40px;color:#1f2933}h2{font-weight:600}</style></head>
<body><h2 id="message">Opening Google Drive…</h2>
<p id="detail">Choose the folder TenderAssist uploads tenders to: in My Drive, shared with you, or in a shared drive.</p>
<script>
const apiKey = ${scriptValue(input.apiKey)};
const appId = ${scriptValue(input.appId)};
const token = ${scriptValue(input.accessToken)};
const answer = ${scriptValue(input.answerPath)};
const say = (message, detail) => { document.getElementById('message').textContent = message; document.getElementById('detail').textContent = detail || ''; };
const send = (body) => fetch(answer, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function open() {
  const folders = () => new google.picker.DocsView(google.picker.ViewId.FOLDERS)
    .setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder');
  const picker = new google.picker.PickerBuilder()
    .addView(folders().setOwnedByMe(true).setLabel('My Drive'))
    .addView(folders().setOwnedByMe(false).setLabel('Shared with me'))
    .addView(folders().setEnableDrives(true).setLabel('Shared drives'))
    .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
    .setAppId(appId).setOAuthToken(token).setDeveloperKey(apiKey)
    .setTitle('Choose the folder TenderAssist uploads to')
    .setCallback((data) => {
      if (data.action === google.picker.Action.PICKED && data.docs && data.docs[0]) {
        const doc = data.docs[0];
        send({ id: doc.id, name: doc.name }).then(() => say('Folder chosen: ' + doc.name, 'You can close this tab and go back to TenderAssist.'));
      } else if (data.action === google.picker.Action.CANCEL) {
        send({ cancelled: true }).then(() => say('No folder chosen.', 'You can close this tab. TenderAssist keeps its folder as it was.'));
      }
    })
    .build();
  picker.setVisible(true);
}
window.onPickerApi = () => gapi.load('picker', { callback: open, onerror: () => send({ error: 'Google Drive could not be opened.' }) });
</script>
<script src="https://apis.google.com/js/api.js?onload=onPickerApi" onerror="send({ error: 'Google could not be reached.' }); say('Google could not be reached.', 'Check the internet connection, then try again from TenderAssist.')"></script>
</body></html>`;
}

/**
 * Opens Google's folder chooser in the browser and waits for the operator's
 * choice: the folder, or null when they cancel. The page is served on
 * 127.0.0.1 under a random path and only for this one choice.
 */
export async function chooseDriveFolder(
  page: Omit<PickerPageInput, 'answerPath'>,
  openBrowser: (url: string) => Promise<void>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<PickedFolder | null> {
  const nonce = randomBytes(16).toString('hex');
  let server: Server | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<PickedFolder | null>((resolve, reject) => {
      server = createServer((request, response) => {
        const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        if (request.method === 'GET' && path === `/${nonce}`) {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
            .end(pickerPage({ ...page, answerPath: `/${nonce}/answer` }));
          return;
        }
        if (request.method !== 'POST' || path !== `/${nonce}/answer`) { response.writeHead(404).end(); return; }
        let body = '';
        request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); if (body.length > 10_000) request.destroy(); });
        request.on('end', () => {
          response.writeHead(204).end();
          let answer: { id?: unknown; name?: unknown; cancelled?: unknown; error?: unknown } = {};
          try { answer = JSON.parse(body) as typeof answer; } catch { /* treated as no answer below */ }
          if (typeof answer.id === 'string' && answer.id) resolve({ id: answer.id, name: typeof answer.name === 'string' ? answer.name : '' });
          else if (answer.cancelled) resolve(null);
          else reject(new GoogleDriveError(typeof answer.error === 'string' ? answer.error : 'Google Drive did not say which folder was chosen.'));
        });
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = (server!.address() as { port: number }).port;
        openBrowser(`http://127.0.0.1:${port}/${nonce}`).catch(reject);
      });
      timer = setTimeout(() => reject(new GoogleDriveError('No folder was chosen in time. Try again, and choose it in the browser within 10 minutes.')), options.timeoutMs ?? 10 * 60_000);
      options.signal?.addEventListener('abort', () => reject(new GoogleDriveError('Choosing the folder was stopped.')), { once: true });
    });
  } finally {
    if (timer) clearTimeout(timer);
    server?.close();
  }
}
