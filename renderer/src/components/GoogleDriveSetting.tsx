import { useEffect, useState } from 'react';
import type { GoogleDriveStatus } from '../../../src/electron/ipcTypes';
import { absoluteDateTime } from '../format';
import { plainError } from '../words';

/** Upload approved tenders straight to a Google Drive folder: paste the folder, sign in once. */
export function GoogleDriveSetting() {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null);
  const [folderLink, setFolderLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const apply = (next: GoogleDriveStatus) => {
    setStatus(next);
    setFolderLink(next.folderId ? `https://drive.google.com/drive/folders/${next.folderId}` : '');
  };
  useEffect(() => { window.tenderAssist.getGoogleDrive().then(apply).catch((err) => setError(plainError(err))); }, []);

  // While Google sign-in waits in the browser, pick up its link in case the browser did not open it.
  useEffect(() => {
    if (busy !== 'connect') return;
    const timer = setInterval(() => {
      window.tenderAssist.getGoogleDrive().then((next) => setStatus((current) => current ? { ...current, signInLink: next.signInLink } : next)).catch(() => {});
    }, 1_500);
    return () => clearInterval(timer);
  }, [busy]);

  const act = async (label: string, work: () => Promise<GoogleDriveStatus>, message: string) => {
    setBusy(label);
    setError(null);
    setDone(null);
    setCopied(false);
    try { apply(await work()); setDone(message); }
    catch (err) { setError(plainError(err)); }
    finally { setBusy(null); }
  };

  if (!status) return null;
  const savedLink = status.folderId ? `https://drive.google.com/drive/folders/${status.folderId}` : '';
  const folderChanged = folderLink.trim() !== savedLink;

  return (
    <fieldset className="settings-fieldset">
      <legend>Upload to Google Drive</legend>
      <p className="field-helper">
        When you approve a tender, TenderAssist uploads its folder (documents and eligibility sheet) and the day’s report sheet to your
        Drive folder, in the same layout as on this computer. Files already uploaded are not sent again.
      </p>
      {!status.available ? (
        <p className="notice notice--attention" role="note">This copy of TenderAssist was built without Google sign-in, so it cannot upload to Drive.</p>
      ) : status.signedIn ? (
        <p className="notice notice--done" role="status">
          Signed in as <strong>{status.accountEmail || 'your Google account'}</strong>. Uploading to
          {' '}<strong>{status.folderName || 'your Drive folder'}</strong>.
          {status.lastUpload && ` Last upload ${absoluteDateTime(status.lastUpload.at)}: ${status.lastUpload.uploaded} uploaded${status.lastUpload.failed ? `, ${status.lastUpload.failed} not uploaded` : ''}.`}
        </p>
      ) : (
        <p className="hint">Not signed in yet: paste your Drive folder link, save it, then sign in to Google.</p>
      )}
      <label className="field field--wide" htmlFor="drive-folder-link"><span>Drive folder link</span>
        <input id="drive-folder-link" type="url" value={folderLink} onChange={(event) => setFolderLink(event.target.value)}
          placeholder="https://drive.google.com/drive/folders/…" disabled={!status.available} />
      </label>
      <div className="now__actions">
        {folderChanged && (
          <button type="button" className="btn btn--quiet" disabled={busy !== null || !status.available}
            onClick={() => act('save', () => window.tenderAssist.saveGoogleDrive({ folderLink }), 'Folder saved.')}>
            {busy === 'save' ? 'Saving…' : 'Save the folder'}
          </button>
        )}
        <button type="button" className="btn btn--primary" disabled={busy !== null || !status.available || !status.folderId || folderChanged}
          onClick={() => act('connect', () => window.tenderAssist.connectGoogleDrive(), 'Signed in. Approved tenders will be uploaded to Drive.')}>
          {busy === 'connect' ? 'Finish signing in in your browser…' : status.signedIn ? 'Sign in again' : 'Sign in to Google'}
        </button>
        {status.signedIn && busy !== 'connect' && (
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
      {busy === 'connect' && status.signInLink && (
        <p className="hint" role="status">
          Sign in to Google in the browser window that opened. If no window opened, or it shows an error, copy the sign-in link and open it
          in another browser or a private (Incognito) window.{' '}
          <button type="button" className="btn btn--quiet btn--small"
            onClick={() => { void navigator.clipboard.writeText(status.signInLink!).then(() => setCopied(true)); }}>
            {copied ? 'Link copied' : 'Copy the sign-in link'}
          </button>
        </p>
      )}
      {error && <p className="notice notice--stop" role="alert">{error}</p>}
      {done && !error && <p className="hint" role="status">{done}</p>}
    </fieldset>
  );
}
