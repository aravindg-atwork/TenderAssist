import { useState, type KeyboardEvent } from 'react';
import { ChipRemoveIcon, PlusIcon } from './icons';

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

  // Several words can be added at once, separated by commas or new lines (pasted from a list).
  const addDraft = () => {
    const next = [...values];
    for (const part of draft.split(/[,;\n]/)) {
      const value = part.trim().replace(/\s+/g, ' ');
      if (value && !next.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) next.push(value);
    }
    if (next.length !== values.length) onChange(next);
    setDraft('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addDraft();
    }
  };

  return (
    <fieldset className="settings-fieldset">
      <legend>{label} <span className="count">{values.length}</span></legend>
      <p className="field-helper" id={`${id}-helper`}>{helper}</p>
      <div className="chip-list" aria-live="polite">
        {values.length === 0 && <span className="chip-list__empty">None yet.</span>}
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
        <button type="button" className={draft.trim() ? 'btn btn--primary' : 'btn btn--quiet'} onClick={addDraft} disabled={!draft.trim()}>
          <PlusIcon /> Add
        </button>
      </div>
      <p className="chip-entry__hint">Press Enter to add. Paste several separated by commas to add them all.</p>
    </fieldset>
  );
}
