import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { SettingsSection } from '../../../src/electron/ipcTypes';
import { TextSizeSetting } from './TextSizeSetting';
import type { RunDefaults } from '../../../src/config/runConfiguration';
import type { PortalCredentialSettings, RunSettingsState } from '../../../src/electron/ipcTypes';
import type { PublishingSettings } from '../../../src/persistence/repositories/publishingSettingsRepository';
import type { UpdateStatus } from '../../../src/electron/updateService';
import { DEFAULT_AUTOMATION_PACING, type AutomationPacingSettings, type AutomationPacingMode } from '../../../src/persistence/repositories/automationSettingsRepository';
import { EditableChips } from './EditableChips';
import { getPortalDefinition } from '../../../src/config/portalRegistry';
import { PortalCompatibilityBadge, PortalSelect } from './PortalSelect';
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
  const [keywords, setKeywords] = useState<string[]>([]);
  const [excludedKeywords, setExcludedKeywords] = useState<string[]>([]);
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
    setKeywords(settings.defaults.keywords);
    setExcludedKeywords(settings.defaults.excludedKeywords);
  }, [settings]);

  const selectedPortal = getPortalDefinition(selectedPortalId);

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
    if (productCategories.length === 0) return setError('Add at least one product category.');
    if (keywords.length === 0) return setError('Add at least one intent keyword.');
    setSaving(true);
    setSaved(false);
    setError(null);
    const defaults: RunDefaults = { productCategories, keywords, excludedKeywords };
    try {
      if (!publishing) throw new Error('Publishing settings are still loading.');
      if (!pacing) throw new Error('Automation pacing settings are still loading.');
      const [next, nextCredentials, nextPublishing, nextPacing] = await Promise.all([
        window.tenderAssist.saveRunSettings(defaults),
        window.tenderAssist.savePortalCredentials(selectedPortalId, {
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

  if (!settings) return <p>Loading settings…</p>;

  return (
    <form className="settings-page" onSubmit={handleSubmit}>
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>Set up portal access and define what a relevant tender means for every new job.</p>
        </div>
        <button className="btn btn-primary" type="submit" disabled={saving || !credentialSettings || !publishing || !pacing}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {!settings.configured && (
        <div className="notice notice-attention" role="status">
          Review the starter values below and save once before running your first job.
        </div>
      )}
      {saved && <div className="notice notice-success" role="status">Settings saved. New jobs will use them.</div>}
      {error && <p className="error-text" role="alert">{error}</p>}

      <section className="settings-card settings-card--portal">
        <div className="settings-card__intro">
          <div>
            <h2>Portal profile</h2>
            <p>Credentials and output folders below belong only to the selected tender website.</p>
          </div>
          <PortalCompatibilityBadge portal={selectedPortal} />
        </div>
        <label className="portal-field" htmlFor="settings-portal">
          <span>Tender website</span>
          <PortalSelect id="settings-portal" value={selectedPortalId} onChange={onPortalChange} disabled={saving} />
        </label>
        {selectedPortal.compatibility === 'BETA' && (
          <p className="field-helper">This site is in the official NIC directory and uses the shared GePNIC family, but its full login, DSC, search, and download flow still needs a live verification.</p>
        )}
      </section>

      <section className="settings-card settings-card--credentials">
        <div className="settings-card__intro">
          <div>
            <h2>{selectedPortal.name} login</h2>
            <p>Prefill this portal securely, then complete CAPTCHA and DSC actions yourself in the embedded browser.</p>
          </div>
        </div>
        <div className="credential-fields">
          <label htmlFor="portal-login-id">
            <span>Login ID</span>
            <input
              id="portal-login-id"
              type="text"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              autoComplete="username"
              placeholder={`${selectedPortal.name} login ID`}
            />
          </label>
          <label htmlFor="portal-password">
            <span>Password</span>
            <input
              id="portal-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder={credentialSettings?.hasSavedPassword ? 'Saved securely — enter only to replace' : 'Enter portal password'}
              disabled={!credentialSettings?.encryptionAvailable}
            />
          </label>
          <label className="credential-checkbox">
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(event) => setRememberPassword(event.target.checked)}
              disabled={!credentialSettings?.encryptionAvailable}
            />
            <span>Remember password on this computer</span>
          </label>
          <p className="credential-security-note">
            {credentialSettings?.encryptionAvailable
              ? 'Password is encrypted for this operating-system account and is never shown back in the app.'
              : 'Secure password storage is unavailable. You can still complete login manually in the embedded browser.'}
          </p>
          {credentialSettings?.hasSavedPassword && (
            <button className="btn btn-secondary credential-forget" type="button" onClick={forgetSavedPassword} disabled={saving}>
              Forget saved password
            </button>
          )}
        </div>
      </section>

      <section className="settings-card settings-card--folders" ref={foldersSectionRef} tabIndex={-1}>
        <div className="settings-card__intro">
          <div>
            <h2>Folders and file names</h2>
            <p>Choose one root folder. TenderAssist creates the month, run date, approved-tender folders, documents, and eligibility sheets inside it.</p>
          </div>
        </div>
        <div className="publishing-field">
          <label htmlFor="local-output-root"><span>Local output folder</span></label>
          <div className="path-picker">
            <input id="local-output-root" type="text" value={publishing?.localOutputRoot ?? ''}
              onChange={(event) => publishing && setPublishing({ ...publishing, localOutputRoot: event.target.value })}
              placeholder="Choose a local working folder" />
            <button className="btn btn-secondary" type="button" onClick={() => choosePublishingFolder('local')}>Browse</button>
          </div>
          <label htmlFor="drive-output-root"><span>Drive copy folder <small>Optional</small></span></label>
          <div className="path-picker">
            <input id="drive-output-root" type="text" value={publishing?.driveOutputRoot ?? ''}
              onChange={(event) => publishing && setPublishing({ ...publishing, driveOutputRoot: event.target.value })}
              placeholder="Choose a Google Drive desktop sync folder" />
            <button className="btn btn-secondary" type="button" onClick={() => choosePublishingFolder('drive')}>Browse</button>
          </div>
          <p className="field-helper">The approved-tenders workbook sits beside the tender folders; each tender folder contains its documents and eligibility workbook. Drive uses the same saved structure when configured.</p>
          <details className="folder-customizer" ref={folderCustomizerRef}>
            <summary>Customize folder and file names</summary>
            <p className="field-helper">Use <code>{'{DD}'}</code>, <code>{'{MM}'}</code>, <code>{'{YYYY}'}</code>, <code>{'{SNO}'}</code>, and <code>{'{TITLE}'}</code>. The tender folder must keep <code>{'{SNO}'}</code> to prevent overwriting.</p>
            <div className="folder-template-grid">
              <label><span>Month folder</span><input value={publishing?.structure.monthFolderTemplate ?? ''} onChange={(event) => updateStructure('monthFolderTemplate', event.target.value)} /></label>
              <label><span>Run-date folder</span><input value={publishing?.structure.dayFolderTemplate ?? ''} onChange={(event) => updateStructure('dayFolderTemplate', event.target.value)} /></label>
              <label className="folder-template-grid__wide"><span>Tender folder</span><input value={publishing?.structure.tenderFolderTemplate ?? ''} onChange={(event) => updateStructure('tenderFolderTemplate', event.target.value)} /></label>
              <label><span>Approved workbook</span><input value={publishing?.structure.approvedWorkbookTemplate ?? ''} onChange={(event) => updateStructure('approvedWorkbookTemplate', event.target.value)} /></label>
              <label><span>Eligibility workbook</span><input value={publishing?.structure.eligibilityWorkbookTemplate ?? ''} onChange={(event) => updateStructure('eligibilityWorkbookTemplate', event.target.value)} /></label>
              <label><span>Documents folder</span><input value={publishing?.structure.documentsFolderTemplate ?? ''} onChange={(event) => updateStructure('documentsFolderTemplate', event.target.value)} /></label>
            </div>
            <div className="folder-preview" aria-live="polite">
              <strong>Preview</strong>
              {structurePreview ? (
                <div className="folder-tree">
                  <span>{structurePreview.monthFolder}/</span>
                  <span>{structurePreview.dayFolder}/</span>
                  <span>{structurePreview.approvedWorkbook}</span>
                  <span>{structurePreview.tenderFolder}/</span>
                  <span>{structurePreview.documentsFolder}/</span>
                  <span>{structurePreview.eligibilityWorkbook}</span>
                </div>
              ) : <p>Finish the templates to see a valid preview.</p>}
            </div>
            <button className="btn btn-secondary folder-reset" type="button" onClick={() => publishing && setPublishing({ ...publishing, structure: DEFAULT_OUTPUT_STRUCTURE })}>
              Restore recommended names
            </button>
          </details>
        </div>
      </section>

      <TextSizeSetting />

      <section className="settings-card">
        <div className="settings-card__intro">
          <div>
            <h2>Portal action pacing</h2>
            <p>Add a randomized pause before automated clicks and form actions. Human-paced is the recommended default; Fast preserves the earlier behavior.</p>
          </div>
        </div>
        <div className="pacing-settings">
          <label htmlFor="pacing-mode"><span>Action speed</span>
            <select id="pacing-mode" value={pacing?.mode ?? 'HUMAN'} onChange={(event) => {
              const mode = event.target.value as AutomationPacingMode;
              setPacing(mode === 'FAST'
                ? { mode, minDelayMs: 0, maxDelayMs: 0 }
                : mode === 'HUMAN'
                  ? DEFAULT_AUTOMATION_PACING
                  : { mode, minDelayMs: pacing?.minDelayMs || 2_000, maxDelayMs: pacing?.maxDelayMs || 5_000 });
            }}>
              <option value="HUMAN">Human-paced · random 2–5 seconds</option>
              <option value="FAST">Fast · no added delay</option>
              <option value="CUSTOM">Custom interval</option>
            </select>
          </label>
          <div className="pacing-range" aria-label="Custom action delay range">
            <label htmlFor="pacing-min"><span>Minimum seconds</span><input id="pacing-min" type="number" min="0" max="60" step="0.5" disabled={pacing?.mode !== 'CUSTOM'} value={(pacing?.minDelayMs ?? 2_000) / 1_000} onChange={(event) => pacing && setPacing({ ...pacing, minDelayMs: Number(event.target.value) * 1_000 })} /></label>
            <label htmlFor="pacing-max"><span>Maximum seconds</span><input id="pacing-max" type="number" min="0" max="60" step="0.5" disabled={pacing?.mode !== 'CUSTOM'} value={(pacing?.maxDelayMs ?? 5_000) / 1_000} onChange={(event) => pacing && setPacing({ ...pacing, maxDelayMs: Number(event.target.value) * 1_000 })} /></label>
          </div>
          <p className="field-helper">The delay is randomized for each supported portal action. CAPTCHA, DSC certificate choice, and DSC password remain human actions.</p>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card__intro">
          <div>
            <h2>Application updates</h2>
            <p>Installed releases check GitHub for signed update packages and download newer versions in the background.</p>
          </div>
        </div>
        <div className="update-control">
          <div><strong>Version {updateStatus?.currentVersion ?? '…'}</strong><p>{updateStatus?.message ?? (updateStatus?.state === 'DOWNLOADING' ? `Downloading ${updateStatus.progressPercent ?? 0}%` : 'Check for a newer release at any time.')}</p></div>
          {updateStatus?.state === 'READY' ? (
            <button className="btn btn-primary" type="button" onClick={() => window.tenderAssist.restartToInstallUpdate()}>Restart and install</button>
          ) : (
            <button className="btn btn-secondary" type="button" disabled={updateStatus?.state === 'CHECKING' || updateStatus?.state === 'DOWNLOADING'} onClick={() => window.tenderAssist.checkForUpdates().then(setUpdateStatus)}>
              {updateStatus?.state === 'CHECKING' ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </div>
      </section>

      <section className="settings-card" ref={relevanceSectionRef} tabIndex={-1}>
        <div className="settings-card__intro">
          <div>
            <h2>Search categories</h2>
            <p>The app runs one portal search for each category.</p>
          </div>
        </div>
        <EditableChips
          id="product-category-entry"
          label="Product categories"
          helper={`Use the exact names shown in the ${selectedPortal.name} product category filter.`}
          values={productCategories}
          onChange={setProductCategories}
          placeholder="Add a product category"
        />
      </section>

      <section className="settings-card">
        <div className="settings-card__intro">
          <div>
            <h2>Positive intent</h2>
            <p>A tender is shortlisted when its detail page contains at least one of these intents.</p>
          </div>
        </div>
        <EditableChips
          id="intent-keyword-entry"
          label="Intent keywords and phrases"
          helper="Prefer specific deliverables such as “web application development” over broad words like “service”."
          values={keywords}
          onChange={setKeywords}
          placeholder="Add an intent phrase"
        />
      </section>

      <section className="settings-card">
        <div className="settings-card__intro">
          <div>
            <h2>Excluded primary scope</h2>
            <p>Reject obvious hardware, maintenance, or other out-of-scope work before it reaches the shortlist.</p>
          </div>
        </div>
        <EditableChips
          id="excluded-keyword-entry"
          label="Exclusion keywords and phrases"
          helper="These are checked against the tender title and primary category, not incidental contract clauses."
          values={excludedKeywords}
          onChange={setExcludedKeywords}
          placeholder="Add an exclusion phrase"
        />
      </section>

      <div className="settings-actions">
        <button className="btn btn-primary" type="submit" disabled={saving || !credentialSettings || !publishing || !pacing}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}
