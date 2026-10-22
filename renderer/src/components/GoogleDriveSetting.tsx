import { useEffect, useState } from 'react';
import type { GoogleDriveStatus } from '../../../src/electron/ipcTypes';
import { absoluteDateTime } from '../format';
import { plainError } from '../words';
import { InfoTip } from './InfoTip';
import { PortalSelect } from './PortalSelect';

/** Where today's files land on Drive, to show the layout under the folder name. */
function todayOnDrive(): { month: string; day: string } {
  const now = new Date();
  const month = `${now.toLocaleString('en-GB', { month: 'long' })}-${now.getFullYear()}`;
  const day = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
  return { month, day };
}

/**
 * Upload tenders to Google Drive, each website to its own folder (Tamil Nadu
 * tenders to one, GeM bids to another): choose a folder the operator already
 * has (My Drive, shared with them, or a shared drive) in Google's own folder
 * chooser, or type a name and TenderAssist makes the folder in My Drive.
 * Month and day folders go inside, signed in with the Google account that
 * activated the key.
 */
export function GoogleDriveSetting({ portalId, onPortalChange }: { portalId: string; onPortalChange: (portalId: string) => void }) {
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
  useEffect(() => {
    setDone(null);
    setError(null);
    window.tenderAssist.getGoogleDrive(portalId).then(apply).catch((err) => setError(plainError(err)));
  }, [portalId]);

  // While Google sign-in waits in the browser, pick up its link in case the browser did not open it.
  useEffect(() => {
    if (busy !== 'connect') return;
    const timer = setInterval(() => {
      window.tenderAssist.getGoogleDrive(portalId).then((next) => setStatus((current) => current ? { ...current, signInLink: next.signInLink } : next)).catch(() => {});
    }, 1_500);
    return () => clearInterval(timer);
  }, [busy, portalId]);

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
  // Where the folder is, as the operator knows it.
  const place = status.folderPicked && !nameChanged ? status.folderName : `My Drive / ${shownName}`;
  const choose = () => act('choose', () => window.tenderAssist.chooseGoogleDriveFolder(portalId), `Folder chosen. ${status.portalName} tenders are uploaded there from now on.`);
  const others = status.portalFolders.filter((item) => item.portalId !== status.portalId);
  const { month, day } = todayOnDrive();

  return (
    <fieldset className="settings-fieldset">
      <legend>Upload to Google Drive<InfoTip label="the Google Drive upload">TenderAssist uses the Google account that activated your key. It can only see the folders you choose or name, and the files it makes there, never the rest of your Drive. A folder shared with you, or in a shared drive, works too if you can add files to it.</InfoTip></legend>
      <p className="field-helper">
        Each website’s tenders go to their own Drive folder: Tamil Nadu tenders to one, GeM bids to another. Choose the folder, or type a name for a new one,
        for every website you search; a search starts only once its website has a folder. After every search, TenderAssist uploads each kept tender’s folder
        (documents and eligibility sheet) and the day’s report sheet into that website’s folder, a folder for each month and inside it a folder for each day.
        Files already uploaded are not sent again.
      </p>
      <label className="field field--wide" htmlFor="drive-portal"><span>Website</span></label>
      <PortalSelect id="drive-portal" value={portalId} onChange={onPortalChange} disabled={busy !== null} />
      {!status.available ? (
        <p className="notice notice--attention" role="note">This copy of TenderAssist was built without Google sign-in, so it cannot upload to Drive.</p>
      ) : status.signedIn ? (
        <p className="notice notice--done" role="status">
          Signed in as <strong>{status.accountEmail || 'your Google account'}</strong>
          {status.folderName
            ? <>. {status.portalName} tenders go to <strong>{status.folderPicked ? status.folderName : `My Drive / ${status.folderName}`}</strong>{status.folderPicked ? ' (the folder you chose)' : ''}.</>
            : <>. {status.portalName} has no Drive folder yet: choose one or type a name below. Its searches start once it has one.</>}
          {status.lastUpload && ` Last upload ${absoluteDateTime(status.lastUpload.at)}: ${status.lastUpload.uploaded} uploaded${status.lastUpload.failed ? `, ${status.lastUpload.failed} not uploaded` : ''}.`}
        </p>
      ) : (
        <p className="hint">Not signed in to Google. The Google account that activated your key is used for Drive; sign in again below if it was signed out.</p>
      )}
      {status.pickerAvailable && (
        <div className="now__actions">
          <button type="button" className="btn btn--primary" disabled={busy !== null || !status.signedIn}
            onClick={choose}>
            {busy === 'choose' ? 'Choose the folder in your browser…' : status.folderPicked ? `Choose another folder for ${status.portalName}` : `Choose a folder in Drive for ${status.portalName}`}
          </button>
          <span className="hint">A folder you already have: in My Drive, shared with you, or in a shared drive.{!status.signedIn && ' Sign in to Google first.'}</span>
        </div>
      )}
      <label className="field field--wide" htmlFor="drive-folder-name"><span>{status.pickerAvailable ? `Or type a name for a new ${status.portalName} folder in My Drive` : `${status.portalName} folder name in your Google Drive`}</span>
        <input id="drive-folder-name" type="text" value={folderName} maxLength={240} onChange={(event) => setFolderName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && nameChanged && busy === null) {
              event.preventDefault();
              void act('save', () => window.tenderAssist.saveGoogleDrive(portalId, { folderName }), 'Folder name saved.');
            }
          }}
          placeholder={`${status.portalName} Tenders`} disabled={!status.available} />
      </label>
      <p className="hint">
        On Drive: {place} / {month} / {day} / <em>each tender’s folder</em> and the day’s report sheet.
        {status.pickerAvailable
          ? <>A name makes a new folder, even if you already have one called that. To use a folder you already have, or one shared with you, choose it in Drive instead.</>
          : <>If you already have a folder with this name, TenderAssist makes its own next to it: it can only see folders it made.</>}
      </p>
      {others.length > 0 && (
        <p className="hint">
          Other websites: {others.map((item, index) => (
            <span key={item.portalId}>{index > 0 && '; '}{item.portalName} → <strong>{item.folderPicked ? item.folderName : `My Drive / ${item.folderName}`}</strong></span>
          ))}.
        </p>
      )}
      {status.earlierFolderName && (
        <p className="hint">Before 0.7.7 every website went to one folder, <strong>{status.earlierFolderName}</strong>. What is there stays there; new uploads go to each website’s own folder.</p>
      )}
      <div className="now__actions">
        {nameChanged && (
          <button type="button" className="btn btn--primary" disabled={busy !== null || !status.available}
            onClick={() => act('save', () => window.tenderAssist.saveGoogleDrive(portalId, { folderName }),
              status.signedIn ? `Folder “${folderName.trim()}” is ready in your Drive.` : 'Folder name saved. It is made in Drive once you are signed in.')}>
            {busy === 'save' ? 'Saving…' : 'Save the folder name'}
          </button>
        )}
        {status.available && !status.signedIn && (
          <button type="button" className="btn btn--primary" disabled={busy !== null}
            onClick={() => act('connect', () => window.tenderAssist.connectGoogleDrive(portalId), 'Signed in. Tenders will be uploaded to Drive.')}>
            {busy === 'connect' ? 'Finish signing in in your browser…' : 'Sign in to Google'}
          </button>
        )}
        {status.signedIn && status.folderId && !nameChanged && (
          <button type="button" className="btn btn--quiet" disabled={busy !== null}
            onClick={() => { setError(null); window.tenderAssist.openGoogleDriveFolder(portalId).catch((err) => setError(plainError(err))); }}>
            Open in Drive
          </button>
        )}
        {status.signedIn && busy !== 'connect' && (
          <>
            <button type="button" className="btn btn--quiet" disabled={busy !== null}
              onClick={() => act('check', () => window.tenderAssist.checkGoogleDrive(portalId), 'Google Drive is reachable and the folder is ready.')}>
              {busy === 'check' ? 'Checking…' : 'Check the connection'}
            </button>
            <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null}
              onClick={() => act('connect', () => window.tenderAssist.connectGoogleDrive(portalId), 'Signed in again.')}>
              Use another Google account
            </button>
            <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null}
              onClick={() => act('disconnect', () => window.tenderAssist.disconnectGoogleDrive(portalId), 'Signed out of Drive. Nothing more will be uploaded until you sign in again.')}>
              Sign out of Drive
            </button>
          </>
        )}
      </div>
      {busy === 'choose' && (
        <p className="hint" role="status">Google Drive’s folder chooser opened in your browser. Pick the folder, then select <strong>Select</strong>. Nothing changes if you close it.</p>
      )}
      {status.signedIn && status.folderName && (
        <p className="hint">
          <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null}
            onClick={() => act('upload', () => window.tenderAssist.uploadEverythingToGoogleDrive(portalId), 'Upload finished. Files already on Drive were not sent again.')}>
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
