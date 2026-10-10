import { useEffect, useState, type ReactNode } from 'react';
import type { LicenceView } from '../../../src/electron/ipcTypes';
import { plainError } from '../words';
import { BrandMark } from './icons';

function dayText(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** Fetches the licence and keeps it current. */
function useLicence(): [LicenceView | null, (view: LicenceView) => void, string | null] {
  const [view, setView] = useState<LicenceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    window.tenderAssist.getLicence().then(setView).catch((err) => setError(plainError(err)));
    return window.tenderAssist.onLicenceChange(setView);
  }, []);
  return [view, setView, error];
}

/** Paste a key, then Google sign-in in the browser. */
function KeyEntry({ initial, onDone, label = 'Continue with Google' }: { initial: string; onDone: (view: LicenceView) => void; label?: string }) {
  const [key, setKey] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activate = async () => {
    setBusy(true);
    setError(null);
    try { onDone(await window.tenderAssist.activateLicence(key)); }
    catch (err) { setError(plainError(err)); }
    finally { setBusy(false); }
  };
  return (
    <div className="licence__entry">
      <label className="field">
        <span>Your key</span>
        <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="TA-XXXXX-XXXXX-XXXXX-XXXXX" spellCheck={false} autoComplete="off"
          className="licence__key" disabled={busy}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (key.trim()) void activate(); } }} />
      </label>
      <button type="button" className="btn btn--primary btn--lg" disabled={busy || !key.trim()} onClick={() => void activate()}>
        {busy ? 'Finish signing in in your browser…' : label}
      </button>
      {busy && <p className="hint">A Google sign-in page opened in your browser. Choose the account this key is for.</p>}
      {error && <p className="licence__error" role="alert">{error}</p>}
    </div>
  );
}

const HEADINGS: Record<string, string> = {
  'not-activated': 'Activate TenderAssist',
  ended: 'Your key has ended',
  suspended: 'Your key is not active',
  'offline-too-long': 'Connect to the internet',
  'clock-wrong': "Check this PC's date and time",
};

/** The whole window when the key does not allow work: first activation, or locked. */
function LicenceScreen({ view, onView }: { view: LicenceView; onView: (view: LicenceView) => void }) {
  const [checking, setChecking] = useState(false);
  const [newKey, setNewKey] = useState(false);
  const firstTime = view.standing === 'not-activated';
  const checkAgain = async () => {
    setChecking(true);
    try { onView(await window.tenderAssist.checkLicence()); } finally { setChecking(false); }
  };
  return (
    <div className="licence">
      <div className="licence__drag" aria-hidden="true" />
      <section className="licence__card">
        <span className="licence__brand"><BrandMark /> TenderAssist</span>
        <h1>{HEADINGS[view.standing] ?? 'TenderAssist needs a key'}</h1>
        {firstTime ? (
          <p className="licence__lede">Paste the key you were given, then sign in with Google. The key is linked to that Google account.</p>
        ) : (
          <p className="licence__lede">{view.message}</p>
        )}
        {view.lastProblem && <p className="licence__error" role="alert">{view.lastProblem}</p>}
        {(firstTime || newKey) ? (
          <KeyEntry initial={view.suggestedKey ?? ''} onDone={onView} />
        ) : (
          <div className="licence__actions">
            <button type="button" className="btn btn--primary btn--lg" disabled={checking} onClick={() => void checkAgain()}>
              {checking ? 'Checking…' : 'Check again'}
            </button>
            <button type="button" className="btn btn--line btn--lg" onClick={() => setNewKey(true)}>Use a different key</button>
          </div>
        )}
        {!firstTime && view.standing === 'ended' && <p className="hint">Renewed already? Press Check again.</p>}
        {view.contact && <p className="licence__contact">{view.contact}</p>}
      </section>
    </div>
  );
}

/**
 * Shows the activation or lock screen instead of the app when the key does not
 * allow work, and a reminder strip in its last days and grace days.
 */
export function LicenceGate({ children }: { children: ReactNode }) {
  const [view, setView, error] = useLicence();
  const [hidden, setHidden] = useState(false);
  if (error) return <div className="licence"><section className="licence__card"><h1>TenderAssist could not start</h1><p className="licence__error">{error}</p></section></div>;
  if (!view) return <div className="licence" aria-busy="true" />;
  if (view.enforced && !view.usable) return <LicenceScreen view={view} onView={setView} />;
  const warn = view.enforced && (view.standing === 'ending' || view.standing === 'grace') && !hidden;
  return (
    <>
      {children}
      {warn && (
        <div className={`licence-strip licence-strip--${view.standing}`} role="status">
          <span>{view.message}{view.contact ? ` ${view.contact}` : ''}</span>
          <button type="button" className="btn btn--text btn--sm" onClick={() => setHidden(true)}>Hide</button>
        </div>
      )}
    </>
  );
}

/** Settings → Licence: what the key is, until when, and changing it. */
export function LicenceSetting() {
  const [view, setView, error] = useLicence();
  const [checking, setChecking] = useState(false);
  const [changing, setChanging] = useState(false);
  if (error) return <><h2>Licence</h2><p className="licence__error">{error}</p></>;
  if (!view) return <h2>Licence</h2>;
  const checkNow = async () => {
    setChecking(true);
    try { setView(await window.tenderAssist.checkLicence()); } finally { setChecking(false); }
  };
  return (
    <>
      <h2>Licence</h2>
      {!view.enforced && <p className="block__lede">This is a development copy: the key is not checked.</p>}
      {view.key ? (
        <dl className="licence__facts">
          <div><dt>Key</dt><dd className="licence__mono">{view.key}</dd></div>
          {view.customer && <div><dt>For</dt><dd>{view.customer}</dd></div>}
          {view.account && <div><dt>Google account</dt><dd>{view.account}</dd></div>}
          {view.lastDay && <div><dt>{view.plan === 'Trial' ? 'Trial until' : 'Valid until'}</dt><dd>{dayText(view.lastDay)}{view.daysLeft !== null && view.daysLeft > 0 ? ` (${view.daysLeft} ${view.daysLeft === 1 ? 'day' : 'days'} left)` : ''}</dd></div>}
          {view.pcsAllowed !== null && <div><dt>PCs</dt><dd>{view.pcsInUse ?? 0} of {view.pcsAllowed} in use</dd></div>}
          {view.checkedAt && <div><dt>Last checked</dt><dd>{new Date(view.checkedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</dd></div>}
        </dl>
      ) : (
        <p className="block__lede">No key on this PC.</p>
      )}
      {view.message && <p className="hint">{view.message}</p>}
      {view.lastProblem && <p className="licence__error">{view.lastProblem}</p>}
      {changing ? (
        <KeyEntry initial="" label="Use this key" onDone={(next) => { setView(next); setChanging(false); }} />
      ) : (
        <div className="licence__actions">
          {view.key && <button type="button" className="btn btn--quiet" disabled={checking} onClick={() => void checkNow()}>{checking ? 'Checking…' : 'Check now'}</button>}
          <button type="button" className="btn btn--text" onClick={() => setChanging(true)}>{view.key ? 'Use a different key' : 'Enter a key'}</button>
        </div>
      )}
      {view.contact && <p className="hint">{view.contact}</p>}
    </>
  );
}
