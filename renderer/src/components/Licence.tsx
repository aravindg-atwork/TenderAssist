import { useEffect, useState, type ReactNode } from 'react';
import { SUPPORT_EMAIL } from '../../../src/config/support';
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

/** Paste a key (or, on a further PC of the same account, leave it empty), then Google sign-in in the browser. */
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
        <span className="hint">Already use TenderAssist on another computer? Leave this empty and sign in with the same Google account.</span>
        <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="TA-XXXXX-XXXXX-XXXXX-XXXXX" spellCheck={false} autoComplete="off"
          className="licence__key" disabled={busy}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void activate(); } }} />
      </label>
      <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => void activate()}>
        {busy ? 'Finish signing in in your browser…' : label}
      </button>
      {busy && <p className="hint">A Google sign-in page opened in your browser. {key.trim() ? 'Choose the account this key is for' : 'Choose the Google account that already has your key'}, and leave the Google Drive box ticked so tenders can be saved to your Drive.</p>}
      {error && <p className="licence__error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * First start: Google sign-in first. A key the installer saved is used with
 * it at once; with none, an account that already has a key (another PC) is
 * done. Only when the account has no key is the key asked for, and the
 * sign-in is not asked for again.
 */
function FirstActivation({ view, onView }: { view: LicenceView; onView: (view: LicenceView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [key, setKey] = useState(view.suggestedKey ?? '');
  const signedIn = view.signedInAs;

  const activate = async (withKey: string) => {
    setBusy(true);
    setError(null);
    try {
      onView(await window.tenderAssist.activateLicence(withKey));
    } catch (err) {
      // Signed in, but no key for this account: the screen turns to asking for the key, which is not an error.
      const next = await window.tenderAssist.getLicence().catch(() => null);
      if (next) onView(next);
      if (!next?.signedInAs || withKey.trim()) setError(plainError(err));
    } finally {
      setBusy(false);
    }
  };
  const otherAccount = async () => {
    setError(null);
    onView(await window.tenderAssist.forgetLicenceSignIn());
  };

  const keyField = (
    <label className="field">
      <span>Activation key</span>
      <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="TA-XXXXX-XXXXX-XXXXX-XXXXX" spellCheck={false} autoComplete="off"
        className="licence__key" disabled={busy} autoFocus
        onKeyDown={(event) => { if (event.key === 'Enter' && key.trim()) { event.preventDefault(); void activate(key); } }} />
    </label>
  );

  if (signedIn) {
    return (
      <>
        <h1>Enter your activation key</h1>
        <p className="licence__lede">
          Google sign-in is done: <strong>{signedIn}</strong>. This account has no TenderAssist key yet, so paste the key you were given to finish.
        </p>
        <div className="licence__entry">
          {keyField}
          <button type="button" className="btn btn--primary btn--lg" disabled={busy || !key.trim()} onClick={() => void activate(key)}>
            {busy ? 'Activating…' : 'Activate'}
          </button>
          <button type="button" className="btn btn--text btn--sm" disabled={busy} onClick={() => void otherAccount()}>Use a different Google account</button>
          {error && <p className="licence__error" role="alert">{error}</p>}
        </div>
      </>
    );
  }

  const ready = Boolean(view.suggestedKey) && !typing;
  return (
    <>
      <h1>Activate TenderAssist</h1>
      <p className="licence__lede">
        {ready
          ? <>Your key <strong className="licence__mono">{view.suggestedKey}</strong> is ready. Sign in with Google to finish: the key is linked to that account, and approved tenders are saved to its Google Drive.</>
          : <>Sign in with Google. If this account already uses TenderAssist on another computer, that is all. If not, you are asked for your activation key next.</>}
      </p>
      <div className="licence__entry">
        {typing && keyField}
        <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => void activate(typing ? key : view.suggestedKey ?? '')}>
          {busy ? 'Finish signing in in your browser…' : 'Sign in with Google'}
        </button>
        {busy && <p className="hint">A Google sign-in page opened in your browser. Choose your account, and leave the Google Drive box ticked so tenders can be saved to your Drive.</p>}
        {!busy && (
          <button type="button" className="btn btn--text btn--sm" onClick={() => setTyping(!typing)}>
            {typing ? 'Sign in without typing a key' : ready ? 'Use a different key' : 'I have a key to paste first'}
          </button>
        )}
        {error && <p className="licence__error" role="alert">{error}</p>}
      </div>
    </>
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
        {firstTime ? <FirstActivation view={view} onView={onView} /> : (
          <>
            <h1>{HEADINGS[view.standing] ?? 'TenderAssist needs a key'}</h1>
            <p className="licence__lede">{view.message}</p>
          </>
        )}
        {view.lastProblem && <p className="licence__error" role="alert">{view.lastProblem}</p>}
        {firstTime ? null : newKey ? (
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
        {view.contact ? <p className="licence__contact">{view.contact}</p>
          : firstTime && <p className="licence__contact">No key yet, or it does not work? Write to <strong>{SUPPORT_EMAIL}</strong>.</p>}
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
