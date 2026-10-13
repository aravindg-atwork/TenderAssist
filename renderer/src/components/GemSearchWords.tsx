import { useEffect, useState } from 'react';
import type { GemSearchWordPreview } from '../../../src/electron/ipcTypes';
import { ChipRemoveIcon, CrossIcon, SearchIcon } from './icons';
import { plainError } from '../words';

const SHOWN = 25;
const MAX_WORDS = 25;

const sameWord = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const closes = (endsAt: string | null) => endsAt
  ? new Date(endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  : null;

interface Props {
  values: string[];
  onChange: (values: string[]) => void;
  onClose: () => void;
}

/**
 * GeM search words (Settings > What to look for > GeM). Every open bid with
 * one of these in its title, category or items is read on each GeM run,
 * whatever its day or category. Each word is checked on GeM before it is
 * added, so the operator sees the bids it brings, and the junk GeM's own box
 * would have brought is dropped (src/gem/gemWordSearch.ts).
 */
export function GemSearchWords({ values, onChange, onClose }: Props) {
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState<GemSearchWordPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const check = async (word: string) => {
    const value = word.trim().replace(/\s+/g, ' ');
    if (!value) return;
    setDraft(value);
    setChecking(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(await window.tenderAssist.previewGemSearchWord(value));
    } catch (err) {
      setError(plainError(err));
    } finally {
      setChecking(false);
    }
  };

  const added = values.some((value) => sameWord(value, draft));
  const add = () => {
    const value = draft.trim().replace(/\s+/g, ' ');
    if (!value || added || values.length >= MAX_WORDS) return;
    onChange([...values, value]);
  };

  const shown = preview?.bids.filter((bid) => bid.visible) ?? [];
  const hidden = preview?.bids.filter((bid) => !bid.visible) ?? [];
  const fresh = shown.filter((bid) => !bid.alreadySeen).length;

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label="GeM search words">
      <button type="button" className="drawer__scrim" aria-label="Close" onClick={onClose} />
      <div className="drawer__panel">
        <header className="drawer__head">
          <h2>GeM search words</h2>
          <button type="button" className="btn btn--text btn--sm" onClick={onClose}><CrossIcon /> Close</button>
        </header>
        <div className="drawer__body replace">
          <p className="replace__intro">
            Words for the exact work you bid for, such as “SEO” or “website development”. On every GeM search, TenderAssist
            finds every open bid with one of them in its title, category or items, whatever day it came out and whatever its
            category, and reads it. Whole words only: “SEO” does not bring “SEOLA” printer cartridges. Check a word on GeM
            first to see what it brings.
          </p>

          <section className="replace__group">
            <h3>Your search words <span className="count">{values.length}</span></h3>
            <div className="chip-list" aria-live="polite">
              {values.length === 0 && <span className="chip-list__empty">None yet. Only your categories are searched.</span>}
              {values.map((value) => (
                <span className="chip" key={value.toLocaleLowerCase()}>
                  <button type="button" className="chip__check" title={`See what “${value}” brings on GeM`} onClick={() => void check(value)}>{value}</button>
                  <button type="button" className="chip__remove" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}>
                    <ChipRemoveIcon />
                  </button>
                </span>
              ))}
            </div>
          </section>

          <section className="replace__group">
            <h3>Check a word on GeM</h3>
            <div className="chip-entry">
              <input value={draft} onChange={(event) => { setDraft(event.target.value); setPreview(null); }} placeholder="SEO, website development, e-learning…"
                aria-label="Search word" disabled={checking}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void check(draft); } }} />
              <button type="button" className="btn btn--line btn--sm" disabled={checking || draft.trim().length < 2} onClick={() => void check(draft)}><SearchIcon /> {checking ? 'Checking GeM…' : 'Check on GeM'}</button>
            </div>
            {error && <div className="alert alert--stop" role="alert"><p>{error}</p></div>}
            {preview && (
              <>
                <p className="words__verdict">
                  <strong>{shown.length === 0 ? 'No open GeM bid' : `${shown.length} open GeM ${shown.length === 1 ? 'bid has' : 'bids have'}`}</strong>
                  {shown.length === 0 ? ` has “${preview.word}” in its title, category or items right now.` : ` “${preview.word}” in the title, category or items`}
                  {shown.length > 0 && (fresh < shown.length ? `; ${shown.length - fresh} you have already seen.` : '.')}
                </p>
                {preview.tooCommon !== null && (
                  <p className="notice notice--attention" role="note">
                    “{preview.word}” is on {preview.tooCommon.toLocaleString('en-IN')} GeM bids, too many to check each time: only the newest are read.
                    Use a longer phrase, such as “{preview.word} development”.
                  </p>
                )}
                {shown.length > 0 && (
                  <ul className="replace__list replace__list--scroll words__list">
                    {shown.slice(0, SHOWN).map((bid) => (
                      <li key={bid.bidNumber} className="words__bid">
                        <a href={bid.url} target="_blank" rel="noreferrer">{bid.title}</a>
                        <small>{bid.bidNumber}{closes(bid.endsAt) ? ` · closes ${closes(bid.endsAt)}` : ''}{bid.alreadySeen ? ' · already seen' : ''}</small>
                      </li>
                    ))}
                    {shown.length > SHOWN && <li className="pick-list__empty">{shown.length - SHOWN} more.</li>}
                  </ul>
                )}
                {hidden.length > 0 && (
                  <p className="replace__meta">
                    GeM also lists {hidden.length} {hidden.length === 1 ? 'bid' : 'bids'} for it without the word in the title, category or items
                    (GeM searches text it does not show). A search reads {hidden.length === 1 ? 'its' : 'their'} bid document: kept if the word is there, otherwise rejected with that reason.
                  </p>
                )}
                {preview.dropped > 0 && (
                  <p className="replace__meta">
                    Left out: {preview.dropped} {preview.dropped === 1 ? 'bid' : 'bids'} GeM’s own search box brings, where “{preview.word}” is only part of another word, the buyer’s name or the buyer’s user ID.
                  </p>
                )}
                <div className="words__add">
                  {added
                    ? <span className="replace__meta">“{preview.word}” is one of your search words.</span>
                    : values.length >= MAX_WORDS
                      ? <span className="replace__meta">Remove a word first: {MAX_WORDS} at most.</span>
                      : <button type="button" className="btn btn--primary btn--sm" onClick={add}>Add “{preview.word}”</button>}
                </div>
              </>
            )}
          </section>
        </div>
        <footer className="replace__foot">
          <span className="replace__meta">Saved with your settings. Bids with an excluded word as well are asked about, never rejected.</span>
          <button type="button" className="btn btn--line" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
