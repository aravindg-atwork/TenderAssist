import { useState, type KeyboardEvent } from 'react';
import type { FamilySuggestions, IntentFamily } from '../../../src/electron/ipcTypes';
import { InfoTip } from './InfoTip';
import { ChipRemoveIcon, PlusIcon } from './icons';

export interface WordFamiliesProps {
  keywords: string[];
  families: IntentFamily[];
  /** Every change keeps the two in step: a family's words are always intent words. */
  onChange: (next: { keywords: string[]; families: IntentFamily[] }) => void;
  suggestions: FamilySuggestions | null;
}

const keyOf = (word: string) => word.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const tidy = (word: string) => word.trim().replace(/\s+/g, ' ');

function withoutWord(families: IntentFamily[], word: string): IntentFamily[] {
  return families.map((family) => ({ ...family, phrases: family.phrases.filter((phrase) => keyOf(phrase) !== keyOf(word)) }));
}

/** The word in the named family (or in none), out of any other. */
function moveWord(families: IntentFamily[], word: string, target: string | null): IntentFamily[] {
  return withoutWord(families, word).map((family) => family.name === target ? { ...family, phrases: [...family.phrases, word] } : family);
}

/**
 * Intent words grouped by the work they mean. A family is only a grouping:
 * each of its words is an intent word like any other.
 */
export function WordFamilies({ keywords, families, onChange, suggestions }: WordFamiliesProps) {
  const [newName, setNewName] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);

  const grouped = new Set(families.flatMap((family) => family.phrases.map(keyOf)));
  const loose = keywords.filter((word) => !grouped.has(keyOf(word)));
  const hasFamily = (name: string) => families.some((family) => keyOf(family.name) === keyOf(name));

  const addWord = (familyName: string, raw: string) => {
    const next = [...keywords];
    let nextFamilies = families;
    for (const part of raw.split(/[,;\n]/)) {
      const word = tidy(part);
      if (!word) continue;
      const existing = next.find((item) => keyOf(item) === keyOf(word));
      if (!existing) next.push(word);
      nextFamilies = moveWord(nextFamilies, existing ?? word, familyName);
    }
    onChange({ keywords: next, families: nextFamilies });
  };
  const removeWord = (word: string) => onChange({ keywords: keywords.filter((item) => item !== word), families: withoutWord(families, word) });
  const move = (word: string, target: string) => onChange({ keywords, families: moveWord(families, word, target || null) });
  const addFamily = (name: string, phrases: string[] = []) => {
    const clean = tidy(name);
    if (!clean || hasFamily(clean)) return;
    let next = [...families, { name: clean, phrases: [] as string[] }];
    for (const phrase of phrases) next = moveWord(next, phrase, clean);
    onChange({ keywords, families: next });
  };
  const rename = () => {
    if (!renaming) return;
    const to = tidy(renaming.to);
    if (to && (keyOf(to) === keyOf(renaming.from) || !hasFamily(to))) {
      onChange({ keywords, families: families.map((family) => family.name === renaming.from ? { ...family, name: to } : family) });
    }
    setRenaming(null);
  };
  const onEnter = (action: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); action(); }
  };

  const moveSelect = (word: string, current: string | null) => families.length > 0 && (
    <select className="chip__move" value={current ?? ''} aria-label={`Family of ${word}`} onChange={(event) => move(word, event.target.value)}>
      <option value="">No family</option>
      {families.map((family) => <option key={family.name} value={family.name}>{family.name}</option>)}
    </select>
  );
  const chip = (word: string, current: string | null) => (
    <span className="chip" key={keyOf(word)}>
      <span>{word}</span>
      {moveSelect(word, current)}
      <button type="button" className="chip__remove" aria-label={`Remove ${word}`} onClick={() => removeWord(word)}><ChipRemoveIcon /></button>
    </span>
  );
  const starters = (suggestions?.starters ?? []).filter((starter) => !hasFamily(starter.name));

  return (
    <fieldset className="settings-fieldset">
      <legend>Word families <span className="count">{families.length}</span>
        <InfoTip label="word families">Buyers word the same work in many ways: “web portal”, “website development”, “e-governance portal”. A family groups those ways under one name. Every word in a family is one of your intent words, and a kept tender’s reason names its family.</InfoTip>
      </legend>
      <p className="field-helper">Group your intent words by the work they mean. Open a family to add words, or to see words suggested for it.</p>

      {families.map((family) => {
        const suggested = (suggestions?.byFamily[family.name] ?? []).filter((item) => !keywords.some((word) => keyOf(word) === keyOf(item.phrase)));
        const notes = [...new Set(suggested.map((item) => item.note).filter((note): note is string => Boolean(note)))];
        return (
          <details key={family.name} className="family">
            <summary>
              <span className="family__name">{family.name}</span> <span className="count">{family.phrases.length}</span>
              <span className="family__preview">{family.phrases.length === 0 ? 'No words yet' : family.phrases.slice(0, 3).join(', ') + (family.phrases.length > 3 ? ', …' : '')}</span>
            </summary>
            <div className="family__body">
              <div className="chip-list" aria-live="polite">
                {family.phrases.length === 0 && <span className="chip-list__empty">None yet.</span>}
                {family.phrases.map((word) => chip(word, family.name))}
              </div>
              <div className="chip-entry">
                <input value={drafts[family.name] ?? ''} placeholder={`Add a way buyers word ${family.name.toLocaleLowerCase()}`} aria-label={`Add a word to ${family.name}`}
                  onChange={(event) => setDrafts({ ...drafts, [family.name]: event.target.value })}
                  onKeyDown={onEnter(() => { addWord(family.name, drafts[family.name] ?? ''); setDrafts({ ...drafts, [family.name]: '' }); })} />
                <button type="button" className={(drafts[family.name] ?? '').trim() ? 'btn btn--primary' : 'btn btn--quiet'} disabled={!(drafts[family.name] ?? '').trim()}
                  onClick={() => { addWord(family.name, drafts[family.name] ?? ''); setDrafts({ ...drafts, [family.name]: '' }); }}>
                  <PlusIcon /> Add
                </button>
              </div>
              {suggested.length > 0 && (
                <div className="family__suggest">
                  <span className="family__label">Suggested for this family</span>
                  <div className="family__chips">
                    {suggested.map((item) => (
                      <button key={item.phrase} type="button" className="chip chip--add" title={item.reason} onClick={() => addWord(family.name, item.phrase)}>
                        <PlusIcon /> <span>{item.phrase}</span>
                      </button>
                    ))}
                  </div>
                  {notes.map((note) => <p key={note} className="hint">{note}</p>)}
                </div>
              )}
              <div className="family__actions">
                {renaming?.from === family.name ? (
                  <span className="chip-entry">
                    <input value={renaming.to} aria-label={`New name for ${family.name}`} autoFocus
                      onChange={(event) => setRenaming({ from: family.name, to: event.target.value })} onKeyDown={onEnter(rename)} />
                    <button type="button" className="btn btn--line btn--small" onClick={rename}>Save name</button>
                    <button type="button" className="btn btn--text btn--small" onClick={() => setRenaming(null)}>Cancel</button>
                  </span>
                ) : (
                  <button type="button" className="btn btn--text btn--small" onClick={() => setRenaming({ from: family.name, to: family.name })}>Rename</button>
                )}
                <button type="button" className="btn btn--text btn--small" onClick={() => onChange({ keywords, families: families.filter((item) => item.name !== family.name) })}>
                  Remove family (keeps its words)
                </button>
              </div>
            </div>
          </details>
        );
      })}

      {families.length > 0 && loose.length > 0 && (
        <div className="family__loose">
          <span className="family__label">Not in a family</span>
          <div className="chip-list">{loose.map((word) => chip(word, null))}</div>
        </div>
      )}

      <div className="chip-entry">
        <input value={newName} placeholder="Name a new family, like “Websites”" aria-label="New family name"
          onChange={(event) => setNewName(event.target.value)} onKeyDown={onEnter(() => { addFamily(newName); setNewName(''); })} />
        <button type="button" className={newName.trim() && !hasFamily(newName) ? 'btn btn--primary' : 'btn btn--quiet'} disabled={!newName.trim() || hasFamily(newName)}
          onClick={() => { addFamily(newName); setNewName(''); }}>
          <PlusIcon /> Add family
        </button>
      </div>
      {starters.length > 0 && (
        <div className="family__suggest">
          <span className="family__label">Usual families for IT tenders</span>
          <div className="family__chips">
            {starters.map((starter) => (
              <button key={starter.name} type="button" className="chip chip--add"
                title={starter.yours.length > 0 ? `Moves your ${starter.yours.map((word) => `“${word}”`).join(', ')} into it` : `For example ${starter.phrases.slice(0, 3).join(', ')}`}
                onClick={() => addFamily(starter.name, starter.yours)}>
                <PlusIcon /> <span>{starter.name}</span>
              </button>
            ))}
          </div>
          <p className="hint">Adding one only makes the family{starters.some((starter) => starter.yours.length > 0) ? ' and moves your own words into it' : ''}; its usual wordings show as suggestions to add one by one.</p>
        </div>
      )}
    </fieldset>
  );
}
