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
    <>
      <h2>Display</h2>
      <p className="block__lede">How large TenderAssist's text is. The portal has its own size: use − and + above the portal.</p>
      <div className="choices" role="radiogroup" aria-label="Text size">
        {OPTIONS.map((option) => (
          <label key={option.value} className={textSize === option.value ? 'choice is-chosen' : 'choice'}>
            <input type="radio" name="text-size" value={option.value} checked={textSize === option.value} onChange={() => void choose(option.value)} />
            <span className="choice__label">{option.label}</span>
            <span className="choice__hint">{option.hint}</span>
          </label>
        ))}
      </div>
      {error && <p className="notice notice--stop" role="alert">{error}</p>}
    </>
  );
}
