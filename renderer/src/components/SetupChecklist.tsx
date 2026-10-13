import { useEffect, useState, type ReactNode } from 'react';
import type { SettingsSection, SetupChecklist as Checklist, SetupStep } from '../../../src/electron/ipcTypes';
import { PORTALS } from '../../../src/config/portalRegistry';
import { InfoTip } from './InfoTip';
import { CheckIcon } from './icons';
import { plainError } from '../words';

type StepId = SetupStep['id'];

/** The step still open, and how far setup is, for the top bar and the sidebar. */
export interface SetupNext { title: string; done: number; total: number }

const TITLES: Record<StepId, string> = {
  activate: 'Activate TenderAssist',
  website: 'Choose your tender website',
  login: 'Save your website login',
  signer: 'Install the DSC signer',
  categories: 'Check the categories to search',
  intent: 'Check the intent words (the work you want)',
  excluded: 'Check the excluded words (the work you don’t)',
  folder: 'Folder on this computer',
  drive: 'Name your Google Drive folder',
};

/** What each step is, in plain words, behind its (i). */
const INFO: Record<StepId, ReactNode> = {
  activate: <>Your key is linked to one Google account and a set number of computers. TenderAssist checks it every few hours, and keeps working offline for up to 3 days.</>,
  website: <>The tender website you search most. Tamil Nadu and other GePNIC websites need your login, a CAPTCHA and your DSC; GeM needs no sign-in. You can still search any website from Today later: this sets up the first one.</>,
  login: <>Your login ID and password for the website. TenderAssist fills them in on the sign-in page; you still type the CAPTCHA and your DSC PIN yourself. The password is locked to your Windows account and never shown again.</>,
  signer: <>GePNIC websites sign you in with your Digital Signature Certificate through a small “DSC signer” program from the website. It runs on OpenWebStart and Java 8 or newer, which TenderAssist can install for you.</>,
  categories: <>The website’s own tender categories, such as “Information Technology”. TenderAssist only reads tenders listed in the categories you choose, so pick the ones your kind of work appears in. The website’s full list appears after your first search.</>,
  intent: <>Words that describe the work you bid for, such as “website development”. A tender is kept when its title has one of these words, or its details have one of these phrases. The starting list is for software, website and e-learning work: replace it with your own work’s words.</>,
  excluded: <>Words that mean “not for us”, such as “civil works”. A tender whose title or category has one of them is rejected straight away, even if it also has an intent word.</>,
  folder: <>Where TenderAssist saves tender documents, eligibility sheets and each day’s report sheet on this computer: a folder for each month, and inside it a folder for each day. It is set for you; change it only if you want another place.</>,
  drive: <>Type a folder name, and TenderAssist makes that folder in the Google Drive of the account that activated the key. Approved tenders and the report sheets are uploaded there after each search, in the same month and day folders.</>,
};

interface Props {
  onOpenSettings: (section: SettingsSection) => void;
  /** The website chosen in step 2 also becomes the one selected on Today. */
  onPortalChange: (portalId: string) => void;
  /** Tells the top bar what is next, or null once setup is complete. */
  onNext?: (next: SetupNext | null) => void;
  /** Something is waiting on Today (Decide): show one line instead of the whole list, opened on request. */
  compact?: boolean;
  /** Put away with "Later": hidden here, opened again from the sidebar or the top bar. */
  tucked?: boolean;
  onTuck?: () => void;
}

/**
 * The first-time setup checklist on Today: activation ticks itself, the
 * website is chosen here, and each other step either ticks itself when done
 * in Settings or is ticked by the operator after checking a word list.
 * Every step has an (i) with what it is for. "Later" puts it in the sidebar
 * until opened again. Gone once everything is done.
 */
export function SetupChecklist({ onOpenSettings, onPortalChange, onNext, compact = false, tucked = false, onTuck }: Props) {
  const [opened, setOpened] = useState(false);
  const [list, setList] = useState<Checklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => window.tenderAssist.getSetupChecklist().then(setList).catch((err) => setError(plainError(err)));
  useEffect(() => {
    void load();
    // Steps done in Settings or elsewhere tick themselves when Today is shown again, or the window regains focus.
    const refresh = () => { void load(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  const firstOpen = list?.steps.find((step) => !step.done);
  const doneCount = list?.steps.filter((step) => step.done).length ?? 0;
  useEffect(() => {
    if (list) onNext?.(list.complete || !firstOpen ? null : { title: TITLES[firstOpen.id], done: doneCount, total: list.steps.length });
  }, [list, firstOpen, doneCount, onNext]);

  if (!list || list.complete) return error ? <p className="notice notice--stop" role="alert">{error}</p> : null;
  // Still loaded above, so the sidebar's count stays right while it is put away.
  if (tucked) return null;
  const later = onTuck && (
    <button type="button" className="btn btn--quiet btn--sm" onClick={onTuck} title="Put the checklist in the sidebar. Open it from there any time.">Later</button>
  );

  const change = async (patch: { portalId?: string; confirm?: 'categories' | 'intent' | 'excluded' }) => {
    setBusy(true);
    setError(null);
    try {
      const next = await window.tenderAssist.saveSetupChecklist(patch);
      setList(next);
      if (patch.portalId) onPortalChange(patch.portalId);
    } catch (err) { setError(plainError(err)); }
    finally { setBusy(false); }
  };

  const done = doneCount;
  if (compact && !opened) {
    return (
      <section className="setup setup--compact" aria-label="Setup">
        <span className="setup__count">Setup {done} of {list.steps.length} done</span>
        <div className="setup__bar" aria-hidden="true"><span style={{ width: `${(done / list.steps.length) * 100}%` }} /></div>
        <span className="setup__detail">Next: {firstOpen ? TITLES[firstOpen.id].charAt(0).toLowerCase() + TITLES[firstOpen.id].slice(1) : 'nothing'}</span>
        <button type="button" className="btn btn--line btn--sm" onClick={() => setOpened(true)}>Continue setup</button>
        {later}
      </section>
    );
  }
  const otherPortals = PORTALS.filter((portal) => portal.id !== 'tamil-nadu' && portal.id !== 'gem');

  const actions = (step: SetupStep): ReactNode => {
    if (step.done && step.id !== 'website') return null;
    switch (step.id) {
      case 'website':
        return (
          <div className="setup__choices" role="radiogroup" aria-label="Tender website">
            {[{ id: 'tamil-nadu', name: 'Tamil Nadu', hint: 'Login, CAPTCHA and DSC' }, { id: 'gem', name: 'GeM', hint: 'No sign-in' }].map((choice) => (
              <button key={choice.id} type="button" role="radio" aria-checked={list.portalId === choice.id} disabled={busy}
                className={list.portalId === choice.id ? 'setup__choice is-on' : 'setup__choice'} onClick={() => void change({ portalId: choice.id })}>
                <strong>{choice.name}</strong><span>{choice.hint}</span>
              </button>
            ))}
            <select className="setup__other" aria-label="Another website" disabled={busy}
              value={list.portalId && list.portalId !== 'tamil-nadu' && list.portalId !== 'gem' ? list.portalId : ''}
              onChange={(event) => { if (event.target.value) void change({ portalId: event.target.value }); }}>
              <option value="">Another website…</option>
              {otherPortals.map((portal) => <option key={portal.id} value={portal.id}>{portal.name}</option>)}
            </select>
          </div>
        );
      case 'login': return <button type="button" className="btn btn--line btn--sm" onClick={() => onOpenSettings('login')}>Enter the login</button>;
      case 'signer': return <button type="button" className="btn btn--line btn--sm" onClick={() => onOpenSettings('signer')}>Install it</button>;
      case 'categories':
      case 'intent':
      case 'excluded':
        return (
          <span className="setup__pair">
            <button type="button" className="btn btn--line btn--sm" onClick={() => onOpenSettings(step.id as 'categories' | 'intent' | 'excluded')}>Review in Settings</button>
            <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => void change({ confirm: step.id as 'categories' | 'intent' | 'excluded' })}>
              <CheckIcon /> I’ve checked them
            </button>
          </span>
        );
      case 'folder':
      case 'drive':
        return <button type="button" className="btn btn--line btn--sm" onClick={() => onOpenSettings('folders')}>{step.id === 'drive' ? 'Name the folder' : 'Change'}</button>;
      default: return null;
    }
  };

  return (
    <section className="setup" aria-labelledby="setup-title">
      <header className="setup__head">
        <h2 id="setup-title">Get set up</h2>
        <span className="setup__count">{done} of {list.steps.length} done</span>
        {later}
      </header>
      <p className="setup__lede">A few one-time steps so your first search runs smoothly. Select <span className="infotip__btn infotip__btn--inline" aria-hidden="true">i</span> beside a step to see what it is for.</p>
      <div className="setup__bar" aria-hidden="true"><span style={{ width: `${(done / list.steps.length) * 100}%` }} /></div>
      <ol className="setup__steps">
        {list.steps.map((step, index) => (
          <li key={step.id} className={step.done ? 'setup__step is-done' : step === firstOpen ? 'setup__step is-next' : 'setup__step'}>
            <span className="setup__tick" aria-hidden="true">{step.done ? <CheckIcon /> : index + 1}</span>
            <div className="setup__main">
              <div className="setup__title">
                <span>{TITLES[step.id]}</span>
                <InfoTip label={TITLES[step.id].toLowerCase()}>{INFO[step.id]}</InfoTip>
                {step.automatic && !step.notNeeded && !step.done && <span className="setup__auto">ticks itself</span>}
              </div>
              <span className="setup__detail">
                <span className="visually-hidden">{step.done ? 'Done. ' : 'Not done yet. '}</span>
                {step.notNeeded ? `Not needed: ${step.detail}` : step.detail}
              </span>
              {(!step.done || step.id === 'website') && <div className="setup__actions">{actions(step)}</div>}
            </div>
          </li>
        ))}
      </ol>
      {error && <p className="notice notice--stop" role="alert">{error}</p>}
    </section>
  );
}
