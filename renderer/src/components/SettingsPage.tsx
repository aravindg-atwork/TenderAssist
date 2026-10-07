import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { SettingsSection } from '../../../src/electron/ipcTypes';
import { TextSizeSetting } from './TextSizeSetting';
import { categoriesForPortal, DEFAULT_GEM_CATEGORIES, type RunDefaults } from '../../../src/config/runConfiguration';
import type { PortalCategoryList, PortalCredentialSettings, RunSettingsState, WordSuggestions } from '../../../src/electron/ipcTypes';
import type { PublishingSettings } from '../../../src/persistence/repositories/publishingSettingsRepository';
import type { UpdateStatus } from '../../../src/electron/updateService';
import { DEFAULT_AUTOMATION_PACING, type AutomationPacingSettings, type AutomationPacingMode } from '../../../src/persistence/repositories/automationSettingsRepository';
import { EditableChips } from './EditableChips';
import { CategoryPicker } from './CategoryPicker';
import { WordSuggestionList } from './WordSuggestionList';
import { getPortalDefinition, isGemPortal } from '../../../src/config/portalRegistry';
import { PortalSelect } from './PortalSelect';
import { DEFAULT_OUTPUT_STRUCTURE, resolveOutputStructure, type OutputStructureSettings } from '../../../src/publishing/outputStructure';

export interface SettingsPageProps {
  settings: RunSettingsState | null;
  onSaved: (settings: RunSettingsState) => void;
  selectedPortalId: string;
  onPortalChange: (portalId: string) => void;
  focusRequest?: { section: SettingsSection; requestId: number } | null;
}

export function SettingsPage({ settings, onSaved, selectedPortalId, onPortalChange, focusRequest }: SettingsPageProps) {
  const [productCategories, setProductCategories] = useState<string[]>([]);
  // Each website's own chosen categories, by website id.
  const [categoriesByPortal, setCategoriesByPortal] = useState<Record<string, string[]>>({});
  const [gemIncludeProducts, setGemIncludeProducts] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [excludedKeywords, setExcludedKeywords] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<WordSuggestions | null>(null);
  const [websiteCategories, setWebsiteCategories] = useState<PortalCategoryList | null>(null);
  const [credentialSettings, setCredentialSettings] = useState<PortalCredentialSettings | null>(null);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);
  const [publishing, setPublishing] = useState<PublishingSettings | null>(null);
  const [pacing, setPacing] = useState<AutomationPacingSettings | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const foldersSectionRef = useRef<HTMLElement>(null);
  const relevanceSectionRef = useRef<HTMLElement>(null);
  const folderCustomizerRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!settings) return;
    setProductCategories(settings.defaults.productCategories);
    setCategoriesByPortal(settings.defaults.categoriesByPortal);
    setGemIncludeProducts(settings.defaults.gemIncludeProducts);
    setKeywords(settings.defaults.keywords);
    setExcludedKeywords(settings.defaults.excludedKeywords);
    // Suggestions leave out the saved words, so ask again whenever they change.
    window.tenderAssist.getWordSuggestions().then(setSuggestions).catch(() => setSuggestions(null));
  }, [settings]);

  const selectedPortal = getPortalDefinition(selectedPortalId);
  const gem = isGemPortal(selectedPortal);
  // The website's own picks, or its starting ones until the operator changes them.
  const chosenCategories = categoriesByPortal[selectedPortal.id]
    ?? categoriesForPortal({ productCategories, keywords, excludedKeywords, categoriesByPortal: {}, gemIncludeProducts }, selectedPortal);
  const setChosenCategories = (values: string[]) => setCategoriesByPortal({ ...categoriesByPortal, [selectedPortal.id]: values });

  // GeM's list comes from GeM itself, with product categories only when product bids are searched.
  useEffect(() => {
    let current = true;
    setWebsiteCategories(null);
    window.tenderAssist.getPortalCategories(selectedPortalId, { includeProducts: gem && gemIncludeProducts })
      .then((list) => { if (current) setWebsiteCategories(list); })
      .catch(() => {});
    return () => { current = false; };
  }, [selectedPortalId, gem, gemIncludeProducts]);

  useEffect(() => {
    let current = true;
    setCredentialSettings(null);
    setPublishing(null);
    setPassword('');
    setSaved(false);
    Promise.all([
      window.tenderAssist.getPortalCredentialSettings(selectedPortalId),
      window.tenderAssist.getPublishingSettings(selectedPortalId),
    ])
      .then(([credentials, output]) => {
        if (!current) return;
        setCredentialSettings(credentials);
        setLoginId(credentials.loginId);
        setRememberPassword(credentials.hasSavedPassword);
        setPublishing(output);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => { current = false; };
  }, [selectedPortalId]);

  useEffect(() => {
    window.tenderAssist.getUpdateStatus().then(setUpdateStatus).catch(() => {});
    return window.tenderAssist.onUpdateStatus(setUpdateStatus);
  }, []);

  useEffect(() => {
    if (focusRequest?.section !== 'relevance') return;
    relevanceSectionRef.current?.scrollIntoView({ block: 'start' });
    relevanceSectionRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);

  useEffect(() => {
    if (focusRequest?.section !== 'folders') return;
    if (folderCustomizerRef.current) folderCustomizerRef.current.open = true;
    foldersSectionRef.current?.scrollIntoView({ block: 'start' });
    foldersSectionRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);

  const previewDate = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  const structurePreview = useMemo(() => {
    try {
      return publishing ? resolveOutputStructure(publishing.structure, previewDate, 'Citizen services portal', 1) : null;
    } catch {
      return null;
    }
  }, [publishing, previewDate]);

  useEffect(() => {
    window.tenderAssist.getAutomationPacing().then(setPacing).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (chosenCategories.length === 0) return setError(`Add at least one category for ${selectedPortal.name}.`);
    if (keywords.length === 0) return setError('Add at least one intent keyword.');
    setSaving(true);
    setSaved(false);
    setError(null);
    const defaults: RunDefaults = { productCategories, keywords, excludedKeywords, categoriesByPortal: { ...categoriesByPortal, [selectedPortal.id]: chosenCategories }, gemIncludeProducts };
    try {
      if (!publishing) throw new Error('Publishing settings are still loading.');
      if (!pacing) throw new Error('Automation pacing settings are still loading.');
      const [next, nextCredentials, nextPublishing, nextPacing] = await Promise.all([
        window.tenderAssist.saveRunSettings(defaults),
        // GeM has no login to save.
        gem ? Promise.resolve(credentialSettings!) : window.tenderAssist.savePortalCredentials(selectedPortalId, {
          loginId,
          password: password || undefined,
          rememberPassword,
        }),
        window.tenderAssist.savePublishingSettings(selectedPortalId, publishing),
        window.tenderAssist.saveAutomationPacing(pacing),
      ]);
      onSaved(next);
      setCredentialSettings(nextCredentials);
      setRememberPassword(nextCredentials.hasSavedPassword);
      setPassword('');
      setPublishing(nextPublishing);
      setPacing(nextPacing);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const choosePublishingFolder = async (kind: 'local' | 'drive') => {
    if (!publishing) return;
    const initial = kind === 'local' ? publishing.localOutputRoot : publishing.driveOutputRoot;
    const folder = await window.tenderAssist.selectPublishingFolder(initial);
    if (folder) setPublishing(kind === 'local'
      ? { ...publishing, localOutputRoot: folder }
      : { ...publishing, driveOutputRoot: folder });
  };

  const updateStructure = (key: keyof OutputStructureSettings, value: string) => {
    if (!publishing) return;
    setPublishing({ ...publishing, structure: { ...publishing.structure, [key]: value } });
  };

  const forgetSavedPassword = async () => {
    if (!window.confirm('Forget the saved portal password on this computer?')) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.tenderAssist.savePortalCredentials(selectedPortalId, { loginId, rememberPassword: false });
      setCredentialSettings(next);
      setRememberPassword(false);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="page"><p className="page__empty">Loading settings…</p></div>;

  const canSave = !saving && Boolean(credentialSettings && publishing && pacing);
  const SECTIONS = [
    ['look', 'What to look for'], ['login', 'Portal login'], ['folders', 'Folders'],
    ['display', 'Display'], ['speed', 'Speed'], ['updates', 'Updates'],
  ] as const;

  return (
    <form className="settings" onSubmit={handleSubmit}>
      <nav className="settings__nav" aria-label="Settings sections">
        <h1>Settings</h1>
        <ul>
          {SECTIONS.map(([id, label]) => (
            <li key={id}><a href={`#settings-${id}`}>{label}</a></li>
          ))}
        </ul>
      </nav>

      <div className="settings__body">
        {!settings.configured && (
          <div className="notice notice--attention">Check the starting values below, then save once before your first search.</div>
        )}

        <section id="settings-look" className="block" ref={relevanceSectionRef} tabIndex={-1}>
          <h2>What to look for</h2>
          <label className="field field--wide" htmlFor="settings-look-portal">
            <span>Website</span>
            <PortalSelect id="settings-look-portal" value={selectedPortalId} onChange={onPortalChange} disabled={saving} />
          </label>
          {gem ? (
            <>
              <p className="block__lede">On GeM, TenderAssist reads every bid that started on the chosen date, wherever it is in India. It reads the bid document of each bid in your GeM categories, and keeps it when the bid mentions one of your intent words and its title has none of the excluded words.</p>
              <CategoryPicker portalName="GeM" websiteList={websiteCategories}
                values={chosenCategories} onChange={setChosenCategories} startingList={DEFAULT_GEM_CATEGORIES}
                unknownListHint="GeM’s category list could not be read just now; these are the starting categories. Check the internet connection and open Settings again." />
              <label className="check">
                <input type="checkbox" checked={gemIncludeProducts} onChange={(event) => setGemIncludeProducts(event.target.checked)} />
                Also search product bids (services are always searched)
              </label>
              <p className="hint">The list is GeM’s own Category list, exactly as GeM shows it. Each website keeps its own categories; the intent and excluded words below are shared by every website.</p>
            </>
          ) : (
            <>
              <p className="block__lede">TenderAssist searches each category for the published date, then keeps a tender only when its full details mention one of your intent words and its title has none of the excluded words.</p>
              <CategoryPicker portalName={selectedPortal.name} websiteList={websiteCategories}
                values={chosenCategories} onChange={setChosenCategories} />
              <p className="hint">These are the categories for {selectedPortal.name} only. Each website keeps its own; choose another website above to see and change its categories.</p>
            </>
          )}
          <EditableChips id="intent-keyword-entry" label="Intent words"
            helper="Be specific, like “web application development”, not broad words like “service”."
            values={keywords} onChange={setKeywords} placeholder="Add an intent word or phrase" />
          <WordSuggestionList title="Suggested intent words, from tenders you approved" suggestions={suggestions?.intent ?? []}
            current={keywords} onAdd={(phrase) => setKeywords([...keywords, phrase])} />
          <EditableChips id="excluded-keyword-entry" label="Excluded words"
            helper="A tender whose title or category has one of these is rejected without opening it."
            values={excludedKeywords} onChange={setExcludedKeywords} placeholder="Add an excluded word" />
          <WordSuggestionList title="Suggested excluded words, from tenders you rejected" suggestions={suggestions?.excluded ?? []}
            current={excludedKeywords} onAdd={(phrase) => setExcludedKeywords([...excludedKeywords, phrase])} />
          {suggestions && suggestions.intent.length + suggestions.excluded.length > 0 && (
            <p className="hint">Suggestions are only added when you select Add, then Save changes.</p>
          )}
        </section>

        <section id="settings-login" className="block">
          <h2>Portal login</h2>
          <p className="block__lede">Your login ID and password are filled in for you. You still type the CAPTCHA and your DSC PIN yourself.</p>
          <label className="field field--wide" htmlFor="settings-portal">
            <span>Website</span>
            <PortalSelect id="settings-portal" value={selectedPortalId} onChange={onPortalChange} disabled={saving} />
          </label>
          {gem ? (
            <p className="hint">GeM needs no login. Its bids and their documents are public, so TenderAssist reads them directly: no CAPTCHA and no DSC.</p>
          ) : selectedPortal.compatibility === 'BETA' && (
            <p className="hint">This website uses the same system as Tamil Nadu, but TenderAssist has not been checked on it yet.</p>
          )}
          {!gem && (<>
          <div className="field-row">
            <label className="field" htmlFor="portal-login-id">
              <span>Login ID</span>
              <input id="portal-login-id" type="text" value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" />
            </label>
            <label className="field" htmlFor="portal-password">
              <span>Password</span>
              <input id="portal-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password"
                placeholder={credentialSettings?.hasSavedPassword ? 'Saved. Type only to change it.' : 'Portal password'}
                disabled={!credentialSettings?.encryptionAvailable} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={rememberPassword} onChange={(event) => setRememberPassword(event.target.checked)} disabled={!credentialSettings?.encryptionAvailable} />
            Remember the password on this computer
          </label>
          <p className="hint">
            {credentialSettings?.encryptionAvailable
              ? 'The password is locked to your Windows account and is never shown again.'
              : 'Saving passwords is not available on this computer; you can still sign in by hand in the portal.'}
          </p>
          {credentialSettings?.hasSavedPassword && (
            <button className="btn btn--quiet btn--small" type="button" onClick={forgetSavedPassword} disabled={saving}>Forget the saved password</button>
          )}
          </>)}
        </section>

        <section id="settings-folders" className="block" ref={foldersSectionRef} tabIndex={-1}>
          <h2>Folders</h2>
          <p className="block__lede">Each published date gets a folder, and each kept tender a folder inside it with its documents, zip and eligibility sheet. Approved tenders are copied to the Drive folder.</p>
          <label className="field field--wide" htmlFor="local-output-root"><span>Save tenders in</span></label>
          <div className="picker">
            <input id="local-output-root" type="text" value={publishing?.localOutputRoot ?? ''}
              onChange={(event) => publishing && setPublishing({ ...publishing, localOutputRoot: event.target.value })} />
            <button className="btn btn--quiet" type="button" onClick={() => choosePublishingFolder('local')}>Choose…</button>
          </div>
          <label className="field field--wide" htmlFor="drive-output-root"><span>Copy approved tenders to Drive folder <small>optional</small></span></label>
          <div className="picker">
            <input id="drive-output-root" type="text" value={publishing?.driveOutputRoot ?? ''}
              onChange={(event) => publishing && setPublishing({ ...publishing, driveOutputRoot: event.target.value })}
              placeholder="Your Google Drive for desktop folder" />
            <button className="btn btn--quiet" type="button" onClick={() => choosePublishingFolder('drive')}>Choose…</button>
          </div>
          <details className="disclosure" ref={folderCustomizerRef}>
            <summary>Change folder and file names</summary>
            <p className="hint">Use {'{DD}'}, {'{MM}'}, {'{YYYY}'}, {'{SNO}'} and {'{TITLE}'}. The tender folder must keep {'{SNO}'} so tenders never overwrite each other.</p>
            <div className="field-grid">
              <label className="field"><span>Month folder</span><input value={publishing?.structure.monthFolderTemplate ?? ''} onChange={(event) => updateStructure('monthFolderTemplate', event.target.value)} /></label>
              <label className="field"><span>Date folder</span><input value={publishing?.structure.dayFolderTemplate ?? ''} onChange={(event) => updateStructure('dayFolderTemplate', event.target.value)} /></label>
              <label className="field field--wide"><span>Tender folder</span><input value={publishing?.structure.tenderFolderTemplate ?? ''} onChange={(event) => updateStructure('tenderFolderTemplate', event.target.value)} /></label>
              <label className="field"><span>Day workbook</span><input value={publishing?.structure.approvedWorkbookTemplate ?? ''} onChange={(event) => updateStructure('approvedWorkbookTemplate', event.target.value)} /></label>
              <label className="field"><span>Eligibility sheet</span><input value={publishing?.structure.eligibilityWorkbookTemplate ?? ''} onChange={(event) => updateStructure('eligibilityWorkbookTemplate', event.target.value)} /></label>
              <label className="field"><span>Documents folder</span><input value={publishing?.structure.documentsFolderTemplate ?? ''} onChange={(event) => updateStructure('documentsFolderTemplate', event.target.value)} /></label>
            </div>
            <div className="tree" aria-live="polite">
              {structurePreview ? (
                <>
                  <span>{structurePreview.monthFolder}/</span>
                  <span className="tree__in1">{structurePreview.dayFolder}/</span>
                  <span className="tree__in2">{structurePreview.approvedWorkbook}</span>
                  <span className="tree__in2">{structurePreview.tenderFolder}/</span>
                  <span className="tree__in3">{structurePreview.documentsFolder}/</span>
                  <span className="tree__in3">{structurePreview.eligibilityWorkbook}</span>
                </>
              ) : <span>Finish the names to see an example.</span>}
            </div>
            <button className="btn btn--quiet btn--small" type="button" onClick={() => publishing && setPublishing({ ...publishing, structure: DEFAULT_OUTPUT_STRUCTURE })}>
              Use the recommended names
            </button>
          </details>
        </section>

        <section id="settings-display" className="block"><TextSizeSetting /></section>

        <section id="settings-speed" className="block">
          <h2>Speed</h2>
          <p className="block__lede">How quickly TenderAssist clicks on the portal. A short random pause between clicks looks like a person and is gentler on a slow portal.</p>
          <div className="choices" role="radiogroup" aria-label="Click speed">
            {([
              ['HUMAN', 'Like a person', '2 to 5 seconds between clicks. Recommended.'],
              ['FAST', 'Fast', 'No pause. Quicker, but harder on a slow portal.'],
              ['CUSTOM', 'Custom', 'Choose the pause yourself.'],
            ] as const).map(([mode, label, hint]) => (
              <label key={mode} className={pacing?.mode === mode ? 'choice is-chosen' : 'choice'}>
                <input type="radio" name="pacing" checked={pacing?.mode === mode} onChange={() => setPacing(mode === 'FAST'
                  ? { mode, minDelayMs: 0, maxDelayMs: 0 }
                  : mode === 'HUMAN' ? DEFAULT_AUTOMATION_PACING
                    : { mode, minDelayMs: pacing?.minDelayMs || 2_000, maxDelayMs: pacing?.maxDelayMs || 5_000 })} />
                <span className="choice__label">{label}</span>
                <span className="choice__hint">{hint}</span>
              </label>
            ))}
          </div>
          {pacing?.mode === 'CUSTOM' && (
            <div className="field-row">
              <label className="field" htmlFor="pacing-min"><span>Shortest pause (seconds)</span>
                <input id="pacing-min" type="number" min="0" max="60" step="0.5" value={pacing.minDelayMs / 1_000} onChange={(event) => setPacing({ ...pacing, minDelayMs: Number(event.target.value) * 1_000 })} /></label>
              <label className="field" htmlFor="pacing-max"><span>Longest pause (seconds)</span>
                <input id="pacing-max" type="number" min="0" max="60" step="0.5" value={pacing.maxDelayMs / 1_000} onChange={(event) => setPacing({ ...pacing, maxDelayMs: Number(event.target.value) * 1_000 })} /></label>
            </div>
          )}
        </section>

        <section id="settings-updates" className="block">
          <h2>Updates</h2>
          <div className="update">
            <div>
              <strong>Version {updateStatus?.currentVersion ?? '…'}</strong>
              <p className="hint">{updateStatus?.message ?? (updateStatus?.state === 'DOWNLOADING' ? `Downloading ${updateStatus.progressPercent ?? 0}%` : 'TenderAssist checks for new versions by itself.')}</p>
            </div>
            {updateStatus?.state === 'READY' ? (
              <button className="btn btn--primary" type="button" onClick={() => window.tenderAssist.restartToInstallUpdate()}>Restart and update</button>
            ) : (
              <button className="btn btn--quiet" type="button" disabled={updateStatus?.state === 'CHECKING' || updateStatus?.state === 'DOWNLOADING'}
                onClick={() => window.tenderAssist.checkForUpdates().then(setUpdateStatus)}>
                {updateStatus?.state === 'CHECKING' ? 'Checking…' : 'Check now'}
              </button>
            )}
          </div>
        </section>
      </div>

      <div className="savebar" aria-live="polite">
        {error && <span className="savebar__error" role="alert">{error}</span>}
        {!error && saved && <span className="savebar__ok">Saved. New searches use these settings.</span>}
        <button className="btn btn--primary" type="submit" disabled={!canSave}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}
