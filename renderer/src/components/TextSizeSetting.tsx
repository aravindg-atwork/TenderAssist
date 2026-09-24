import { useEffect, useState } from 'react';
import type { TextSize } from '../../../src/persistence/repositories/displaySettingsRepository';
import { applyTextSize } from '../display';

const OPTIONS: { value: TextSize; label: string; hint: string }[] = [
  { value: 'STANDARD', label: 'Standard', hint: '16 px body text' },
  { value: 'LARGE', label: 'Large', hint: '18 px body text' },
  { value: 'EXTRA_LARGE', label: 'Extra large', hint: '20 px body text' },
];

export function TextSizeSetting() {
  const [textSize, setTextSize] = useState<TextSize | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.tenderAssist.getTextSize().then(setTextSize).catch(console.error);
  }, []);

  const choose = async (next: TextSize) => {
    const previous = textSize;
    setTextSize(next);
    applyTextSize(next);
    setError(null);
    try {
      await window.tenderAssist.saveTextSize(next);
    } catch (err) {
      if (previous) { setTextSize(previous); applyTextSize(previous); }
      setError(err instanceof Error ? err.message : 'Text size could not be saved.');
    }
  };

  return (
    <section className="settings-card">
      <div className="settings-card__intro">
        <div>
          <h2>Display</h2>
          <p>Choose how large TenderAssist text appears. This changes immediately and does not affect the portal; use the portal toolbar's − and + buttons to zoom the portal separately.</p>
        </div>
      </div>
      <fieldset className="text-size-options">
        <legend>Text size</legend>
        {OPTIONS.map((option) => (
          <label key={option.value} className={textSize === option.value ? 'text-size-option is-selected' : 'text-size-option'}>
            <input
              type="radio"
              name="text-size"
              value={option.value}
              checked={textSize === option.value}
              onChange={() => void choose(option.value)}
            />
            <span className="text-size-option__label">{option.label}</span>
            <span className="text-size-option__hint">{option.hint}</span>
          </label>
        ))}
      </fieldset>
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
