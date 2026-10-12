import { useEffect, useState } from 'react';
import type { SignerStatus } from '../../../src/electron/ipcTypes';
import { plainError } from '../words';

/**
 * Settings → DSC signer: OpenWebStart and Java, which the GePNIC portals' DSC
 * signer runs on. Skipped during setup? Install them here, with the same
 * checked downloads the installer uses.
 */
export function SignerSetting() {
  const [status, setStatus] = useState<SignerStatus | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.tenderAssist.getSignerStatus().then(setStatus).catch((err) => setError(plainError(err)));
    return window.tenderAssist.onSignerInstallProgress((line) => setLines((current) => [...current.slice(-7), line]));
  }, []);

  const install = async () => {
    setBusy(true);
    setLines([]);
    setResult(null);
    setError(null);
    try {
      const done = await window.tenderAssist.installSigner();
      setStatus(done);
      setResult(done);
    } catch (err) { setError(plainError(err)); }
    finally { setBusy(false); }
  };

  const ready = status?.java && status.openWebStart;
  const state = (found: boolean | undefined) => (status ? (found ? 'Installed' : 'Not installed') : 'Checking…');

  return (
    <>
      <h2>DSC signer</h2>
      <p className="block__lede">
        Tamil Nadu and other GePNIC tender websites sign you in with your Digital Signature Certificate through a small “DSC signer” program from the website.
        It runs on OpenWebStart and Java 8 or newer. GeM does not need them.
      </p>
      {status && !status.supported ? (
        <p className="hint">The DSC signer setup is for Windows.</p>
      ) : (
        <>
          <dl className="facts">
            <div><dt>Java 8 or newer</dt><dd>{state(status?.java)}</dd></div>
            <div><dt>OpenWebStart</dt><dd>{state(status?.openWebStart)}</dd></div>
          </dl>
          {ready ? (
            <p className="notice notice--done" role="status">Everything the DSC signer needs is installed.</p>
          ) : status && (
            <>
              <p className="hint">
                TenderAssist downloads what is missing from the official Eclipse Temurin (Java, about 31 MB) and OpenWebStart (about 70 MB) releases,
                checks each file before installing, and installs it. Windows asks for permission once.
              </p>
              <div className="now__actions">
                <button type="button" className="btn btn--primary" disabled={busy || status.installing} onClick={() => void install()}>
                  {busy ? 'Installing… this takes a few minutes' : 'Install the DSC signer'}
                </button>
              </div>
            </>
          )}
          {busy && lines.length > 0 && (
            <ul className="hint" aria-live="polite">{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
          )}
          {result && <p className={result.ok ? 'notice notice--done' : 'notice notice--attention'} role="status">{result.message}</p>}
        </>
      )}
      {error && <p className="notice notice--stop" role="alert">{error}</p>}
    </>
  );
}
