import { useEffect, useState } from 'react';
import type { GoogleDriveStatus } from '../../../src/electron/ipcTypes';
import { absoluteDateTime } from '../format';
import { plainError } from '../words';

/** Upload approved tenders straight to a Google Drive folder: no Google app on this computer. */
export function GoogleDriveSetting() {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null);
  const [folderLink, setFolderLink] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const apply = (next: GoogleDriveStatus) => {
    setStatus(next);
    setClientId(next.clientId);
    setFolderLink(next.folderId ? `https://drive.google.com/drive/folders/${next.folderId}` : '');
    setClientSecret('');
  };
  useEffect(() => { window.tenderAssist.getGoogleDrive().then(apply).catch((err) => setError(plainError(err))); }, []);

  const act = async (label: string, work: () => Promise<GoogleDriveStatus>, message: string) => {
    setBusy(label);
    setError(null);
    setDone(null);
    try { apply(await work()); setDone(message); }
    catch (err) { setError(plainError(err)); }
    finally { setBusy(null); }
  };

  if (!status) return null;
  const ready = Boolean(status.clientId && status.hasClientSecret && status.folderId);

  return (
    <fieldset className="settings-fieldset">
      <legend>Upload to Google Drive</legend>
      <p className="field-helper">
        When you approve a tender, TenderAssist uploads its folder (documents and eligibility sheet) and the day’s report sheet to this
        Drive folder, in the same layout as on this computer. Files already uploaded are not sent again. No Google app is needed on this computer.
      </p>
      {status.signedIn ? (
        <p className="notice notice--done" role="status">
          Signed in as <strong>{status.accountEmail || 'your Google account'}</strong>. Uploading to
          {' '}<strong>{status.folderName || 'the Drive folder'}</strong>.
          {status.lastUpload && ` Last upload ${absoluteDateTime(status.lastUpload.at)}: ${status.lastUpload.uploaded} uploaded${status.lastUpload.failed ? `, ${status.lastUpload.failed} not uploaded` : ''}.`}
        </p>
      ) : (
        <p className="hint">Not signed in yet. Fill in the three boxes, save, then sign in. The setup steps are in “How to get the Client ID”.</p>
      )}
      <label className="field field--wide" htmlFor="drive-folder-link"><span>Drive folder link</span>
        <input id="drive-folder-link" type="url" value={folderLink} onChange={(event) => setFolderLink(event.target.value)}
          placeholder="https://drive.google.com/drive/folders/…" />
      </label>
      <div className="field-row">
        <label className="field" htmlFor="drive-client-id"><span>Client ID</span>
          <input id="drive-client-id" type="text" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="….apps.googleusercontent.com" />
        </label>
        <label className="field" htmlFor="drive-client-secret"><span>Client secret</span>
          <input id="drive-client-secret" type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)}
            placeholder={status.hasClientSecret ? 'Saved. Type only to change it.' : 'Client secret'} disabled={!status.encryptionAvailable} autoComplete="off" />
        </label>
      </div>
      <div className="now__actions">
        <button type="button" className="btn btn--quiet" disabled={busy !== null}
          onClick={() => act('save', () => window.tenderAssist.saveGoogleDrive({ clientId, clientSecret: clientSecret || undefined, folderLink }), 'Saved.')}>
          {busy === 'save' ? 'Saving…' : 'Save these details'}
        </button>
        <button type="button" className="btn btn--primary" disabled={busy !== null || !ready}
          onClick={() => act('connect', () => window.tenderAssist.connectGoogleDrive(), 'Signed in. Approved tenders will be uploaded to Drive.')}>
          {busy === 'connect' ? 'Finish signing in in your browser…' : status.signedIn ? 'Sign in again' : 'Sign in to Google'}
        </button>
        {status.signedIn && (
          <>
            <button type="button" className="btn btn--quiet" disabled={busy !== null}
              onClick={() => act('check', () => window.tenderAssist.checkGoogleDrive(), 'Google Drive is reachable and the folder can be written to.')}>
              {busy === 'check' ? 'Checking…' : 'Check the connection'}
            </button>
            <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null}
              onClick={() => act('disconnect', () => window.tenderAssist.disconnectGoogleDrive(), 'Signed out. Nothing more will be uploaded until you sign in again.')}>
              Sign out
            </button>
          </>
        )}
      </div>
      {error && <p className="notice notice--stop" role="alert">{error}</p>}
      {done && !error && <p className="hint" role="status">{done}</p>}
      <details className="disclosure">
        <summary>How to get the Client ID and secret (one time, by whoever manages your Google account)</summary>
        <ol className="steps-list">
          <li>Open console.cloud.google.com and create a project, for example “TenderAssist”.</li>
          <li>APIs &amp; Services → Library → search “Google Drive API” → Enable.</li>
          <li>APIs &amp; Services → OAuth consent screen: choose <strong>Internal</strong> (Google Workspace accounts), app name “TenderAssist”, your email, Save.</li>
          <li>APIs &amp; Services → Credentials → Create credentials → OAuth client ID → Application type <strong>Desktop app</strong> → Create.</li>
          <li>Copy the Client ID and Client secret into the boxes above, paste the Drive folder link, Save, then Sign in to Google.</li>
        </ol>
        <p className="hint">The signed-in account must be able to add files to the Drive folder (Editor access). The sign-in is stored on this computer, locked to your Windows account, and is never in backups or support bundles.</p>
      </details>
    </fieldset>
  );
}
