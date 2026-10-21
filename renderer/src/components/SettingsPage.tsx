import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CompanyProfileSetting } from './CompanyProfileSetting';
import type { SettingsSection } from '../../../src/electron/ipcTypes';
import { TextSizeSetting } from './TextSizeSetting';
import { GoogleDriveSetting } from './GoogleDriveSetting';
import { ReportSheetsSetting } from './ReportSheetsSetting';
import { SignerSetting } from './SignerSetting';
import { InfoTip } from './InfoTip';
import { gemCategoryKey } from '../../../src/config/categoryHealth';

const CATEGORY_INFO = <>The website’s own tender categories, such as “Information Technology”. TenderAssist only reads tenders listed in the categories chosen here, so choose the ones your kind of work appears in. The website’s full list appears after your first search.</>;
const INTENT_INFO = <>Words for the work you bid for. A tender is kept when its <strong>title</strong> has one of the single words (like “website”), or its title or details have one of the phrases (like “website development”). Use your own work’s words: the starting list is for software, website and e-learning work.</>;
const EXCLUDED_INFO = <>Words that mean “not for us”, such as “civil works” or “furniture”. A tender whose title or category has one of them is rejected straight away, even if it also has an intent word.</>;
import { LicenceSetting } from './Licence';
import { categoriesForPortal, DEFAULT_GEM_CATEGORIES, TOO_BROAD_INTENT_WORDS, type RunDefaults } from '../../../src/config/runConfiguration';
import type { CategoryHealth, MissingCategory, PortalCategoryList, PortalCredentialSettings, RunSettingsState, WordSuggestions } from '../../../src/electron/ipcTypes';
import type { PublishingSettings } from '../../../src/persistence/repositories/publishingSettingsRepository';
import type { UpdateStatus } from '../../../src/electron/updateService';
import { DEFAULT_AUTOMATION_PACING, type AutomationPacingSettings, type AutomationPacingMode } from '../../../src/persistence/repositories/automationSettingsRepository';
import { EditableChips } from './EditableChips';
import { CategoryPicker } from './CategoryPicker';
import { GemSearchWords } from './GemSearchWords';
import { CategoryReplacement, withReplacements } from './CategoryReplacement';
import { WordSuggestionList } from './WordSuggestionList';
import { getPortalDefinition, isGemPortal } from '../../../src/config/portalRegistry';
import { refreshCategoryNames } from '../../../src/gem/gemBid';
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
  /** GeM search words: open bids with one are read whatever their day or category. */
  const [gemSearchWords, setGemSearchWords] = useState<string[]>([]);
  const [wordsOpen, setWordsOpen] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [excludedKeywords, setExcludedKeywords] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<WordSuggestions | null>(null);
  const [websiteCategories, setWebsiteCategories] = useState<PortalCategoryList | null>(null);
  const [categoryHealth, setCategoryHealth] = useState<CategoryHealth | null>(null);
  const [replacing, setReplacing] = useState<MissingCategory[] | null>(null);
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
    setGemSearchWords(settings.defaults.gemSearchWords ?? []);
    setKeywords(settings.defaults.keywords);
    setExcludedKeywords(settings.defaults.excludedKeywords);
    // Suggestions leave out the saved words, so ask again whenever they change.
    window.tenderAssist.getWordSuggestions().then(setSuggestions).catch(() => setSuggestions(null));
  }, [settings]);

  const selectedPortal = getPortalDefinition(selectedPortalId);
  const wordKey = (word: string) => word.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const broadWords = keywords.filter((word) => TOO_BROAD_INTENT_WORDS.includes(wordKey(word)));
  const gem = isGemPortal(selectedPortal);
  const gemCategoryCounts = useCallback((names: string[]) => window.tenderAssist.getGemCategoryCounts(selectedPortalId, names), [selectedPortalId]);
  // The website's own picks, or its starting ones until the operator changes them.
  const chosenCategories = categoriesByPortal[selectedPortal.id]
    ?? categoriesForPortal({ productCategories, keywords, excludedKeywords, categoriesByPortal: {}, gemIncludeProducts }, selectedPortal);
  const setChosenCategories = (values: string[]) => setCategoriesByPortal({ ...categoriesByPortal, [selectedPortal.id]: values });

  // GeM rewords the example after a category's name now and then; follow its current wording.
  useEffect(() => {
    if (!gem || !websiteCategories || websiteCategories.categories.length === 0) return;
    const refreshed = refreshCategoryNames(chosenCategories, websiteCategories.categories);
    const changed = refreshed.length !== chosenCategories.length || refreshed.some((name, index) => name !== chosenCategories[index]);
    if (changed) setCategoriesByPortal((current) => ({ ...current, [selectedPortal.id]: refreshed }));
    // Only when the list arrives, not on every pick.
  }, [gem, websiteCategories, selectedPortal.id]);

  // GeM's list comes from GeM itself: services and products together, as GeM shows them.
  useEffect(() => {
    let current = true;
    setWebsiteCategories(null);
    window.tenderAssist.getPortalCategories(selectedPortalId)
      .then((list) => { if (current) setWebsiteCategories(list); })
      .catch(() => {});
    window.tenderAssist.getCategoryHealth(selectedPortalId)
      .then((health) => { if (current) setCategoryHealth(health); })
      .catch(() => {});
    return () => { current = false; };
  }, [selectedPortalId, settings]);

  const openReplacement = (names: string[]) => setReplacing(names.map((name) =>
    categoryHealth?.missing.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase()) ?? { name, lastSeen: null, longGone: false }));
  const markNewLooked = () => {
    window.tenderAssist.markNewCategoriesLooked(selectedPortalId)
      .then(() => setCategoryHealth((health) => health && { ...health, newOnWebsite: [] }))
      .catch(() => {});
  };
  const categoryHelp = { health: categoryHealth, onReplace: openReplacement, onNewLooked: markNewLooked };

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

  // What auto-save compares: everything on these pages except the password being typed.
  const snapshot = JSON.stringify({ productCategories, categoriesByPortal, gemIncludeProducts, gemSearchWords, keywords, excludedKeywords, loginId, rememberPassword, publishing, pacing, portal: selectedPortalId });
  const lastSaved = useRef<string | null>(null);
  const loaded = Boolean(settings && credentialSettings && publishing && pacing);

  /**
   * Saves every part of Settings. "auto" runs a moment after a change: it
   * waits quietly while something required is missing, and never saves a
   * password still being typed (Next or Save changes does).
   */
  const saveAll = async (mode: 'explicit' | 'auto'): Promise<boolean> => {
    if (chosenCategories.length === 0 || keywords.length === 0) {
      if (mode === 'explicit') setError(chosenCategories.length === 0 ? `Add at least one category for ${selectedPortal.name}.` : 'Add at least one intent keyword.');
      return false;
    }
    if (!publishing || !pacing || !credentialSettings) return false;
    const savingSnapshot = snapshot;
    setSaving(true);
    setSaved(false);
    setError(null);
    const defaults: RunDefaults = { productCategories, keywords, excludedKeywords, categoriesByPortal: { ...categoriesByPortal, [selectedPortal.id]: chosenCategories },
      // Product bids now follow the chosen categories (a product category searches them), so the old switch is cleared.
      gemIncludeProducts: false, gemSearchWords };
    const withCredentials = !gem && (mode === 'explicit' || password === '');
    try {
      const [next, nextCredentials, nextPublishing, nextPacing] = await Promise.all([
        window.tenderAssist.saveRunSettings(defaults),
        // GeM has no login to save.
        withCredentials ? window.tenderAssist.savePortalCredentials(selectedPortalId, {
          loginId,
          password: password || undefined,
          rememberPassword,
        }) : Promise.resolve(credentialSettings),
        window.tenderAssist.savePublishingSettings(selectedPortalId, publishing),
        window.tenderAssist.saveAutomationPacing(pacing),
      ]);
      lastSaved.current = savingSnapshot;
      onSaved(next);
      setCredentialSettings(nextCredentials);
      if (withCredentials) {
        setRememberPassword(nextCredentials.hasSavedPassword);
        if (mode === 'explicit') setPassword('');
      }
      if (mode === 'explicit') {
        setPublishing(nextPublishing);
        setPacing(nextPacing);
      }
      setSaved(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await saveAll('explicit');
  };

  // Auto-save: a moment after the last change, once everything has loaded.
  useEffect(() => {
    if (!loaded) return;
    if (lastSaved.current === null) { lastSaved.current = snapshot; return; }
    if (snapshot === lastSaved.current || saving) return;
    const timer = window.setTimeout(() => { void saveAll('auto'); }, 1_200);
    return () => window.clearTimeout(timer);
    // saveAll reads the latest state through this render's closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, loaded, saving]);

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

  // One section at a time: the side list switches between them.
  const [active, setActive] = useState<'look' | 'company' | 'login' | 'signer' | 'folders' | 'display' | 'speed' | 'updates' | 'licence'>('look');
  useEffect(() => {
    if (focusRequest?.section === 'relevance') setActive('look');
    if (focusRequest?.section === 'folders') setActive('folders');
    if (focusRequest?.section === 'signer') setActive('signer');
    if (focusRequest?.section === 'login') setActive('login');
    if (focusRequest?.section === 'categories' || focusRequest?.section === 'intent' || focusRequest?.section === 'excluded') {
      setActive('look');
      // After the section shows: bring that list into view.
      const target = `look-${focusRequest.section}`;
      setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
    }
  }, [focusRequest]);

  if (!settings) return <div className="page"><p className="page__empty">Loading settings…</p></div>;

  const canSave = !saving && Boolean(credentialSettings && publishing && pacing);
  const SECTIONS = [
    ['look', 'What to look for'], ['company', 'Your company'], ['login', 'Portal login'], ['signer', 'DSC signer'], ['folders', 'Folders'],
    ['display', 'Display'], ['speed', 'Speed'], ['updates', 'Updates'], ['licence', 'Licence'],
  ] as const;

  return (
    <form className="settings" onSubmit={handleSubmit}>
      <nav className="settings__nav" aria-label="Settings sections">
        <h1>Settings</h1>
        <ul>
          {SECTIONS.map(([id, label]) => (
            <li key={id}><button type="button" className={active === id ? 'setnav is-on' : 'setnav'} aria-current={active === id ? 'page' : undefined} onClick={() => setActive(id)}>{label}</button></li>
          ))}
        </ul>
      </nav>

      <div className="settings__body">
        <section id="settings-look" hidden={active !== 'look'} className="block" ref={relevanceSectionRef} tabIndex={-1}>
          <h2>What to look for<InfoTip label="what to look for">TenderAssist searches the website for tenders in your <strong>categories</strong>, keeps the ones whose words match your <strong>intent words</strong>, and rejects the ones with an <strong>excluded word</strong>. Anything it is unsure about, it asks you.</InfoTip></h2>
          {!settings.configured && (
            <div className="notice notice--attention">Check the starting values below, then select Save changes at the bottom once before your first search.</div>
          )}
          <label className="field field--wide" htmlFor="settings-look-portal">
            <span>Website</span>
            <PortalSelect id="settings-look-portal" value={selectedPortalId} onChange={onPortalChange} disabled={saving} />
          </label>
          {gem ? (
            <>
              <p className="block__lede">Bids in these categories are kept when they mention an intent word.</p>
              <div id="look-categories" />
              <CategoryPicker portalName="GeM" websiteList={websiteCategories} info={CATEGORY_INFO} keyOf={gemCategoryKey}
                values={chosenCategories} onChange={setChosenCategories} startingList={DEFAULT_GEM_CATEGORIES} {...categoryHelp}
                countsFor={gemCategoryCounts}
                unknownListHint="GeM’s category list could not be read just now; these are the starting categories. Check the internet connection and open Settings again." />
              <div className="words-row">
                <div className="words-row__text">
                  <strong>Search words</strong>
                  <span>{gemSearchWords.length === 0
                    ? 'None. Add the exact words for your work (such as “SEO”) to also find open bids outside your categories and days.'
                    : `${gemSearchWords.map((word) => `“${word}”`).join(', ')}: every open GeM bid with one of these is read on each search.`}</span>
                </div>
                <button type="button" className="btn btn--line btn--sm" onClick={() => setWordsOpen(true)}>Search words…</button>
              </div>
              {wordsOpen && <GemSearchWords values={gemSearchWords} onChange={setGemSearchWords} onClose={() => setWordsOpen(false)} />}
              <p className="hint">The list is GeM’s own Category list from its advanced search, services and products, exactly as GeM shows it. “Open now” is GeM’s own count of bids open in that category today; the other number is how many started in it on the days you searched GeM. Each website keeps its own categories; the intent and excluded words below are shared by every website.</p>
            </>
          ) : (
            <>
              <p className="block__lede">Tenders in these categories are kept when they mention an intent word.</p>
              <div id="look-categories" />
              <CategoryPicker portalName={selectedPortal.name} websiteList={websiteCategories} info={CATEGORY_INFO}
                values={chosenCategories} onChange={setChosenCategories} {...categoryHelp} />
            </>
          )}
          <div id="look-intent" />
          <EditableChips id="intent-keyword-entry" label="Intent words" info={INTENT_INFO}
            helper="Start with 2 to 4 phrases from tenders you bid for, worded as their titles are (like “website development”). A single word counts only in a tender’s title; a phrase also counts in its details. Suggestions below come from the tenders you approve."
            values={keywords} onChange={setKeywords} placeholder="Add an intent word or phrase" />
          {broadWords.length > 0 && (
            <p className="notice notice--attention" role="note">
              {broadWords.map((word) => `“${word}”`).join(', ')} on {broadWords.length === 1 ? 'its' : 'their'} own {broadWords.length === 1 ? 'is' : 'are'} too broad:
              it keeps tenders that are not your work (for example, “AMC” keeps maintenance contracts for furnaces and RO plants).
              Remove {broadWords.length === 1 ? 'it' : 'them'}, or use a phrase such as “software AMC” or “website maintenance”.
            </p>
          )}
          <WordSuggestionList title="Suggested intent words, from tenders you approved" suggestions={suggestions?.intent ?? []}
            current={keywords} onAdd={(phrase) => setKeywords([...keywords, phrase])} />
          <div id="look-excluded" />
          <EditableChips id="excluded-keyword-entry" label="Excluded words" info={EXCLUDED_INFO}
            helper="A tender whose title or category has one of these is rejected without opening it."
            values={excludedKeywords} onChange={setExcludedKeywords} placeholder="Add an excluded word" />
          <WordSuggestionList title="Suggested excluded words, from tenders you rejected" suggestions={suggestions?.excluded ?? []}
            current={excludedKeywords} onAdd={(phrase) => setExcludedKeywords([...excludedKeywords, phrase])} />
          {suggestions && suggestions.intent.length + suggestions.excluded.length > 0 && (
            <p className="hint">Suggestions are only added when you select Add, then Save changes.</p>
          )}
        </section>

        <section id="settings-company" hidden={active !== 'company'} className="block"><CompanyProfileSetting /></section>

        <section id="settings-login" hidden={active !== 'login'} className="block">
          <h2>Portal login<InfoTip label="the portal login">Your login ID and password for the tender website. At sign-in TenderAssist fills them in; you still type the CAPTCHA and your DSC PIN yourself. The password is locked to your Windows account and is never shown again. GeM needs no login.</InfoTip></h2>
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

        <section id="settings-folders" hidden={active !== 'folders'} className="block" ref={foldersSectionRef} tabIndex={-1}>
          <h2>Folders<InfoTip label="folders">Where tenders are saved on this computer, how each day’s report sheet is split, and the Google Drive folder approved tenders are uploaded to. The computer folder is set for you; the Drive folder needs only a name.</InfoTip></h2>
          <p className="block__lede">Each month gets a folder, each date a folder inside it, and each kept tender a folder inside that with its documents (and the zip, where the website offers one) and eligibility sheet. Approved tenders are uploaded to your Google Drive folder.</p>
          <label className="field field--wide" htmlFor="local-output-root"><span>Save tenders in<InfoTip label="the save folder">The folder on this computer where every tender’s documents and the report sheets are saved. It is set for you (DocumentsTenderAssist); choose another only if your office keeps files elsewhere.</InfoTip></span></label>
          <div className="picker">
            <input id="local-output-root" type="text" value={publishing?.localOutputRoot ?? ''}
              onChange={(event) => publishing && setPublishing({ ...publishing, localOutputRoot: event.target.value })} />
            <button className="btn btn--quiet" type="button" onClick={() => choosePublishingFolder('local')}>Choose…</button>
          </div>
          <ReportSheetsSetting />
          <GoogleDriveSetting />
          <details className="disclosure" ref={folderCustomizerRef}>
            <summary>More folder options: names, and a Google Drive for desktop copy</summary>
            <label className="field field--wide" htmlFor="drive-output-root"><span>Also copy approved tenders to a Google Drive for desktop folder <small>optional; not needed when the Drive folder above is named</small></span></label>
            <div className="picker">
              <input id="drive-output-root" type="text" value={publishing?.driveOutputRoot ?? ''}
                onChange={(event) => publishing && setPublishing({ ...publishing, driveOutputRoot: event.target.value })}
                placeholder="Your Google Drive for desktop folder" />
              <button className="btn btn--quiet" type="button" onClick={() => choosePublishingFolder('drive')}>Choose…</button>
            </div>
            <p className="hint">Use {'{DD}'}, {'{MM}'} (10), {'{MONTH}'} (October), {'{YYYY}'}, {'{SNO}'} and {'{TITLE}'}. The tender folder must keep {'{SNO}'} so tenders never overwrite each other.</p>
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

        <section id="settings-display" hidden={active !== 'display'} className="block"><TextSizeSetting /></section>

        <section id="settings-speed" hidden={active !== 'speed'} className="block">
          <h2>Speed</h2>
          <p className="block__lede">How quickly TenderAssist clicks on the portal. A short random pause between clicks looks like a person and is gentler on a slow portal.</p>
          <div className="choices" role="radiogroup" aria-label="Click speed">
            {([
              ['HUMAN', 'Like a person', '2 to 5 seconds between clicks. Recommended.'],
              ['FAST', 'Fast', 'No pause. Quicker, but harder on a slow portal.'],
              ['CUSTOM', 'Custom', 'Choose the pause yourself.'],
            ] as const).map(([mode, label, hint]) => (
              <label key={mode} className={pacing?.mode === mode ? 'choice is-chosen' : 'choice'}>
                <input type="radio" name="pacing" checked={pacing?.mode === mode} onChange={() => setPacing({
                  // The typing choice below is kept when the click speed changes.
                  ...(mode === 'FAST'
                    ? { mode, minDelayMs: 0, maxDelayMs: 0 }
                    : mode === 'HUMAN' ? DEFAULT_AUTOMATION_PACING
                      : { mode, minDelayMs: pacing?.minDelayMs || 2_000, maxDelayMs: pacing?.maxDelayMs || 5_000 }),
                  typing: pacing?.typing ?? 'HUMAN',
                })} />
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
          <h3 className="block__sub">Typing</h3>
          <p className="block__lede">How TenderAssist types your login ID and password on the website. This is separate from the pause between clicks. You always type the CAPTCHA yourself.</p>
          <div className="choices" role="radiogroup" aria-label="Typing">
            {([
              ['HUMAN', 'Like a person', 'One key at a time, with small natural pauses. Recommended.'],
              ['INSTANT', 'All at once', 'The whole login ID and password appear at once.'],
            ] as const).map(([typing, label, hint]) => (
              <label key={typing} className={(pacing?.typing ?? 'HUMAN') === typing ? 'choice is-chosen' : 'choice'}>
                <input type="radio" name="typing" checked={(pacing?.typing ?? 'HUMAN') === typing} disabled={!pacing}
                  onChange={() => pacing && setPacing({ ...pacing, typing })} />
                <span className="choice__label">{label}</span>
                <span className="choice__hint">{hint}</span>
              </label>
            ))}
          </div>
        </section>

        <section id="settings-signer" hidden={active !== 'signer'} className="block"><SignerSetting /></section>

        <section id="settings-updates" hidden={active !== 'updates'} className="block">
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

        <section id="settings-licence" hidden={active !== 'licence'} className="block"><LicenceSetting /></section>
      </div>

      {(() => {
        const index = SECTIONS.findIndex(([id]) => id === active);
        const next = SECTIONS[index + 1];
        return next ? (
          <div className="settings__next">
            <button type="button" className="btn btn--primary" disabled={!canSave}
              onClick={() => void saveAll('explicit').then((ok) => { if (ok) setActive(next[0]); })}>
              Next: {next[1]} →
            </button>
          </div>
        ) : null;
      })()}

      <div className="savebar" aria-live="polite">
        {error && <span className="savebar__error" role="alert">{error}</span>}
        {!error && saving && <span className="savebar__ok">Saving…</span>}
        {!error && !saving && saved && <span className="savebar__ok">All changes saved. New searches use these settings.</span>}
        {!error && !saving && !saved && password !== '' && <span className="savebar__ok">The new password is saved when you press Next or Save changes.</span>}
        <button className="btn btn--primary" type="submit" disabled={!canSave}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
      {replacing && (
        <CategoryReplacement portalId={selectedPortalId} portalName={selectedPortal.name} missing={replacing}
          chosen={chosenCategories}
          onSkip={() => setReplacing(null)}
          onApply={(add, remove) => {
            // Shown in the list straight away; Save changes keeps it, as with any other edit.
            setChosenCategories(withReplacements(chosenCategories, add, remove));
            setReplacing(null);
          }} />
      )}
    </form>
  );
}
