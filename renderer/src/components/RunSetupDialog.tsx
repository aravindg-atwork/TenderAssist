import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { RunConfiguration, RunDefaults } from '../../../src/config/runConfiguration';
import { ChipRemoveIcon } from './icons';

interface EditableChipsProps {
  id: string;
  label: string;
  helper: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}

function EditableChips({ id, label, helper, values, onChange, placeholder }: EditableChipsProps) {
  const [draft, setDraft] = useState('');

  const addDraft = () => {
    const value = draft.trim().replace(/\s+/g, ' ');
    if (!value || values.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) return;
    onChange([...values, value]);
    setDraft('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addDraft();
    }
  };

  return (
    <fieldset className="setup-fieldset">
      <legend>{label}</legend>
      <p className="field-helper" id={`${id}-helper`}>{helper}</p>
      <div className="chip-list" aria-live="polite">
        {values.map((value) => (
          <span className="chip" key={value.toLocaleLowerCase()}>
            <span>{value}</span>
            <button
              type="button"
              className="chip__remove"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
            >
              <ChipRemoveIcon />
            </button>
          </span>
        ))}
      </div>
      <div className="chip-entry">
        <input
          id={id}
          value={draft}
          placeholder={placeholder}
          aria-describedby={`${id}-helper`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="button" className="btn btn-secondary" onClick={addDraft} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </fieldset>
  );
}

export interface RunSetupDialogProps {
  defaults: RunDefaults;
  today: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (config: RunConfiguration) => void;
}

export function RunSetupDialog({ defaults, today, submitting, onCancel, onSubmit }: RunSetupDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const [searchDate, setSearchDate] = useState(today);
  const [productCategories, setProductCategories] = useState(defaults.productCategories);
  const [keywords, setKeywords] = useState(defaults.keywords);
  const [excludedKeywords, setExcludedKeywords] = useState(defaults.excludedKeywords);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dateRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onCancel();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, submitting]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!searchDate) return setError('Choose a published date.');
    if (productCategories.length === 0) return setError('Add at least one product category.');
    if (keywords.length === 0) return setError('Add at least one intent keyword.');
    setError(null);
    onSubmit({ searchDate, productCategories, keywords, excludedKeywords });
  };

  return (
    <div className="modal-backdrop">
      <div
        ref={panelRef}
        className="setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-setup-title"
        aria-describedby="run-setup-description"
      >
        <form onSubmit={handleSubmit}>
          <div className="setup-dialog__header">
            <div>
              <h2 id="run-setup-title">Set up this tender run</h2>
              <p id="run-setup-description">
                These values are saved as your next-run defaults and snapshotted with this job.
              </p>
            </div>
          </div>

          <div className="setup-dialog__body">
            <label className="form-field" htmlFor="search-date">
              <span>Published date</span>
              <input
                ref={dateRef}
                id="search-date"
                type="date"
                value={searchDate}
                max={today}
                disabled={submitting}
                onChange={(event) => setSearchDate(event.target.value)}
              />
            </label>

            <EditableChips
              id="product-category-entry"
              label="Product categories"
              helper="Use the exact category names shown by the TN Tenders portal."
              values={productCategories}
              onChange={setProductCategories}
              placeholder="Add a product category"
            />
            <EditableChips
              id="intent-keyword-entry"
              label="Intent keywords"
              helper="A tender must contain at least one of these terms on its detail page."
              values={keywords}
              onChange={setKeywords}
              placeholder="Add an intent phrase"
            />
            <EditableChips
              id="excluded-keyword-entry"
              label="Exclude primary scope"
              helper="If one of these terms appears in the title or primary category, the tender is rejected."
              values={excludedKeywords}
              onChange={setExcludedKeywords}
              placeholder="Add an exclusion phrase"
            />
            {error && <p className="error-text form-error" role="alert">{error}</p>}
          </div>

          <div className="setup-dialog__footer">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Opening Chrome…' : 'Start & open Chrome'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
