import { useState, type KeyboardEvent } from 'react';
import { ChipRemoveIcon } from './icons';

export interface EditableChipsProps {
  id: string;
  label: string;
  helper: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}

export function EditableChips({ id, label, helper, values, onChange, placeholder }: EditableChipsProps) {
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
    <fieldset className="settings-fieldset">
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
        <button type="button" className="btn btn--quiet" onClick={addDraft} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </fieldset>
  );
}
