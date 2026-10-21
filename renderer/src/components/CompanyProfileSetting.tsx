import { useEffect, useState } from 'react';
import type { CompanyProfile, CompanyProject, LegalForm } from '../../../src/electron/ipcTypes';
import { EditableChips } from './EditableChips';
import { InfoTip } from './InfoTip';

const LEGAL_FORMS: Array<[LegalForm, string]> = [
  ['', 'Choose…'], ['PRIVATE_LIMITED', 'Private limited company'], ['PUBLIC_LIMITED', 'Public limited company'],
  ['LLP', 'LLP'], ['PARTNERSHIP', 'Partnership firm'], ['PROPRIETORSHIP', 'Proprietorship'], ['SOCIETY', 'Society or trust'],
];

const numberText = (value: number | null) => (value === null ? '' : String(value));
const toNumber = (text: string) => (text.trim() === '' ? null : Number(text));

/**
 * Settings → Your company: the facts tenders ask about (turnover, years,
 * projects, staff, certificates), entered once. Every tender's file then says
 * which of its criteria the company meets. Saved on its own button.
 */
export function CompanyProfileSetting() {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.tenderAssist.getCompanyProfile().then(setProfile).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (!profile) return <><h2>Your company</h2>{error ? <p className="notice notice--stop" role="alert">{error}</p> : <p className="hint">Loading…</p>}</>;

  const update = (patch: Partial<CompanyProfile>) => { setProfile({ ...profile, ...patch }); setSaved(false); };
  const updateProject = (index: number, patch: Partial<CompanyProject>) =>
    update({ projects: profile.projects.map((project, at) => (at === index ? { ...project, ...patch } : project)) });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      setProfile(await window.tenderAssist.saveCompanyProfile(profile));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2>Your company<InfoTip label="your company">Tenders ask for a turnover, years in business, past projects of a value, staff and certificates. Enter yours once: every tender’s file then shows “Do we qualify?”, with the criteria your company does not meet first. Anything TenderAssist cannot check is left for you to read.</InfoTip></h2>
      <p className="block__lede">Enter these once. Each tender then shows which of its eligibility criteria your company meets, and which it does not.</p>
      <div className="field-row">
        <label className="field" htmlFor="company-name">
          <span>Company name <small>(as registered)</small></span>
          <input id="company-name" type="text" value={profile.companyName} onChange={(event) => update({ companyName: event.target.value })} />
        </label>
        <label className="field" htmlFor="company-form">
          <span>Type of firm</span>
          <select id="company-form" value={profile.legalForm} onChange={(event) => update({ legalForm: event.target.value as LegalForm })}>
            {LEGAL_FORMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field" htmlFor="company-turnover">
          <span>Average yearly turnover <small>(last 3 financial years, ₹ lakh)</small></span>
          <input id="company-turnover" type="number" min="0" step="any" inputMode="decimal" placeholder="e.g. 1200 for ₹12 crore"
            value={numberText(profile.averageTurnoverLakh)} onChange={(event) => update({ averageTurnoverLakh: toNumber(event.target.value) })} />
        </label>
        <label className="field" htmlFor="company-years">
          <span>Years in business</span>
          <input id="company-years" type="number" min="0" step="1" inputMode="numeric"
            value={numberText(profile.yearsInBusiness)} onChange={(event) => update({ yearsInBusiness: toNumber(event.target.value) })} />
        </label>
        <label className="field" htmlFor="company-staff">
          <span>Technical staff on your payroll</span>
          <input id="company-staff" type="number" min="0" step="1" inputMode="numeric"
            value={numberText(profile.technicalStaff)} onChange={(event) => update({ technicalStaff: toNumber(event.target.value) })} />
        </label>
        <label className="field" htmlFor="company-networth">
          <span>Net worth in each of the last 3 years</span>
          <select id="company-networth" value={profile.positiveNetWorth === null ? '' : profile.positiveNetWorth ? 'yes' : 'no'}
            onChange={(event) => update({ positiveNetWorth: event.target.value === '' ? null : event.target.value === 'yes' })}>
            <option value="">Not said</option>
            <option value="yes">Positive</option>
            <option value="no">Not positive</option>
          </select>
        </label>
      </div>
      <div className="company__checks">
        <label className="check"><input type="checkbox" checked={profile.mse} onChange={(event) => update({ mse: event.target.checked })} /> MSE (Udyam registered)</label>
        <label className="check"><input type="checkbox" checked={profile.startup} onChange={(event) => update({ startup: event.target.checked })} /> DPIIT-recognised startup</label>
        <label className="check"><input type="checkbox" checked={profile.blacklisted} onChange={(event) => update({ blacklisted: event.target.checked })} /> Blacklisted or debarred anywhere now</label>
      </div>
      <EditableChips id="company-certificates" label="Certificates held" values={profile.certifications} onChange={(certifications) => update({ certifications })}
        helper="As tenders name them, such as “ISO 9001”, “ISO 27001” or “CMMI Level 3”." placeholder="Add a certificate" />

      <h3 className="company__sub">Completed projects</h3>
      <p className="hint">The work orders you would show as experience. Tenders ask for a number of similar projects above a value within some years.</p>
      {profile.projects.length > 0 && (
        <div className="company__projects" role="table" aria-label="Completed projects">
          <div className="company__project company__project--head" role="row">
            <span role="columnheader">Project</span><span role="columnheader">Value (₹ lakh)</span><span role="columnheader">Year completed</span><span />
          </div>
          {profile.projects.map((project, index) => (
            <div key={index} className="company__project" role="row">
              <input aria-label="Project" type="text" value={project.name} onChange={(event) => updateProject(index, { name: event.target.value })} />
              <input aria-label="Value in lakh rupees" type="number" min="0" step="any" value={numberText(project.valueLakh)} onChange={(event) => updateProject(index, { valueLakh: toNumber(event.target.value) })} />
              <input aria-label="Year completed" type="number" min="1990" max="2100" step="1" value={numberText(project.year)} onChange={(event) => updateProject(index, { year: toNumber(event.target.value) })} />
              <button type="button" className="btn btn--quiet btn--small" onClick={() => update({ projects: profile.projects.filter((_, at) => at !== index) })}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn btn--line btn--small" onClick={() => update({ projects: [...profile.projects, { name: '', valueLakh: null, year: null }] })}>Add a project</button>

      <div className="company__save">
        <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save company facts'}</button>
        {saved && <span className="hint" role="status">Saved. Open any tender to see “Do we qualify?”.</span>}
      </div>
      {error && <p className="notice notice--stop" role="alert">{error}</p>}
    </>
  );
}
