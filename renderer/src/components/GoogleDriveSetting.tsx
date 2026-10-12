import { useEffect, useState } from 'react';
import type { GoogleDriveStatus } from '../../../src/electron/ipcTypes';
import { absoluteDateTime } from '../format';
import { plainError } from '../words';

/** Where today's files land on Drive, to show the layout under the folder name. */
function todayOnDrive(): { month: string; day: string } {
  const now = new Date();
  const month = `${now.toLocaleString('en-GB', { month: 'long' })}-${now.getFullYear()}`;
  const day = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
  return { month, day };
}

/**
 * Upload tenders to Google Drive: type a folder name. TenderAssist makes the
 * folder in My Drive (month and day folders inside), signed in with the same
 * Google account that activated the key.
 */
export function GoogleDriveSetting() {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null);
  const [folderName, setFolderName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const apply = (next: GoogleDriveStatus) => {
    setStatus(next);
    setFolderName(next.folderName);
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
  const nameChanged = folderName.trim() !== status.folderName;
  const shownName = folderName.trim() || 'your folder';
  const { month, day } = todayOnDrive();

  return (
    <fieldset className="settings-fieldset">
      <legend>Upload to Google Drive</legend>
      <p className="field-helper">
        Type a folder name. TenderAssist makes that folder in your Google Drive and, after every search, uploads each approved tender’s folder
        (documents and eligibility sheet) and the day’s report sheet into it, a folder for each month and inside it a folder for each day.
        Files already uploaded are not sent again.
      </p>
      {!status.available ? (
        <p className="notice notice--attention" role="note">This copy of TenderAssist was built without Google sign-in, so it cannot upload to Drive.</p>
      ) : status.signedIn ? (
        <p className="notice notice--done" role="status">
          Signed in as <strong>{status.accountEmail || 'your Google account'}</strong>
          {status.folderName ? <>. Uploading to <strong>My Drive / {status.folderName}</strong>.</> : '. Type a folder name below to start uploading.'}
          {status.lastUpload && ` Last upload ${absoluteDateTime(status.lastUpload.at)}: ${status.lastUpload.uploaded} uploaded${status.lastUpload.failed ? `, ${status.lastUpload.failed} not uploaded` : ''}.`}
        </p>
      ) : (
        <p className="hint">Not signed in to Google. The Google account that activated your key is used for Drive; sign in again below if it was signed out.</p>
      )}
      <label className="field field--wide" htmlFor="drive-folder-name"><span>Folder name in your Google Drive</span>
        <input id="drive-folder-name" type="text" value={folderName} maxLength={240} onChange={(event) => setFolderName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && nameChanged && busy === null) {
              event.preventDefault();
              void act('save', () => window.tenderAssist.saveGoogleDrive({ folderName }), 'Folder name saved.');
            }
          }}
          placeholder="Tenders 2026-27" disabled={!status.available} />
      </label>
      <p className="hint">
        On Drive: My Drive / {shownName} / {month} / {day} / <em>each tender’s folder</em> and the day’s report sheet.
        If you already have a folder with this name, TenderAssist makes its own next to it: it can only see folders it made.
      </p>
      <div className="now__actions">
        {nameChanged && (
          <button type="button" className="btn btn--primary" disabled={busy !== null || !status.available}
            onClick={() => act('save', () => window.tenderAssist.saveGoogleDrive({ folderName }),
              status.signedIn ? `Folder “${folderName.trim()}” is ready in your Drive.` : 'Folder name saved. It is made in Drive once you are signed in.')}>
            {busy === 'save' ? 'Saving…' : 'Save the folder name'}
          </button>
        )}
        {status.available && !status.signedIn && (
          <button type="button" className="btn btn--primary" disabled={busy !== null}
            onClick={() => act('connect', () => window.tenderAssist.connectGoogleDrive(), 'Signed in. Tenders will be uploaded to Drive.')}>
            {busy === 'connect' ? 'Finish signing in in your browser…' : 'Sign in to Google'}
          </button>
        )}
        {status.signedIn && status.folderId && !nameChanged && (
          <button type="button" className="btn btn--quiet" disabled={busy !== null}
            onClick={() => { setError(null); window.tenderAssist.openGoogleDriveFolder().catch((err) => setError(plainError(err))); }}>
            Open in Drive
          </button>
        )}
        {status.signedIn && busy !== 'connect' && (
          <>
            <button type="button" className="btn btn--quiet" disabled={busy !== null}
              onClick={() => act('check', () => window.tenderAssist.checkGoogleDrive(), 'Google Drive is reachable and the folder is ready.')}>
              {busy === 'check' ? 'Checking…' : 'Check the connection'}
            </button>
            <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null}
              onClick={() => act('connect', () => window.tenderAssist.connectGoogleDrive(), 'Signed in again.')}>
              Use another Google account
            </button>
            <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null}
              onClick={() => act('disconnect', () => window.tenderAssist.disconnectGoogleDrive(), 'Signed out of Drive. Nothing more will be uploaded until you sign in again.')}>
              Sign out of Drive
            </button>
          </>
        )}
      </div>
      {status.signedIn && status.folderName && (
        <p className="hint">
          <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null}
            onClick={() => act('upload', () => window.tenderAssist.uploadEverythingToGoogleDrive(), 'Upload finished. Files already on Drive were not sent again.')}>
            {busy === 'upload' ? 'Uploading… this can take a few minutes' : 'Upload everything saved so far'}
          </button>{' '}
          Sends every approved tender folder and report sheet already on this computer. Anything already on Drive and unchanged is skipped.
        </p>
      )}
      {busy === 'connect' && status.signInLink && (
        <p className="hint" role="status">
          Sign in to Google in the browser window that opened and leave the Google Drive box ticked. If no window opened, or it shows an error,
          copy the sign-in link and open it in another browser or a private (Incognito) window.{' '}
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
