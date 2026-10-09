import { useEffect, useMemo, useState } from 'react';
import type { MissingCategory, ReplacementAdvice } from '../../../src/electron/ipcTypes';
import { CrossIcon } from './icons';
import { absoluteDateTime } from '../format';
import { plainError } from '../words';

export interface CategoryReplacementProps {
  portalId: string;
  portalName: string;
  missing: MissingCategory[];
  /** Categories already chosen, which are not offered again. */
  chosen: string[];
  includeProducts?: boolean;
  /** Add these categories; stop searching the dropped ones in `remove`. */
  onApply: (add: string[], remove: string[]) => void;
  onSkip: () => void;
  /** Closed without choosing (Close, Escape); defaults to skipping. */
  onClose?: () => void;
}

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
const MAX_OTHERS = 60;

/** The chosen categories after a replacement: dropped ones removed, picked ones added once. */
export function withReplacements(chosen: readonly string[], add: readonly string[], remove: readonly string[]): string[] {
  const next = chosen.filter((name) => !remove.some((item) => sameName(item, name)));
  for (const name of add) if (!next.some((item) => sameName(item, name))) next.push(name);
  return next;
}

/** Where a dropped category was last seen, in a short phrase. */
export function missingSince(category: MissingCategory): string {
  return category.lastSeen ? `Last on the website’s list ${absoluteDateTime(category.lastSeen)}` : 'Not on the website’s list';
}

/**
 * Pick what to search instead of categories the website dropped. Several
 * can be picked; suggestions lead with where wanted tenders were listed.
 * Skipping keeps everything as it is; Settings can change it later.
 */
export function CategoryReplacement({ portalId, portalName, missing, chosen, includeProducts, onApply, onSkip, onClose = onSkip }: CategoryReplacementProps) {
  const [advice, setAdvice] = useState<ReplacementAdvice[] | null>(null);
  const [websiteList, setWebsiteList] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  // A category gone for two weeks is offered for removal; one gone a day or two is kept, it may come back.
  const [remove, setRemove] = useState<string[]>(() => missing.filter((item) => item.longGone).map((item) => item.name));
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all(missing.map((item) => window.tenderAssist.suggestCategoryReplacements(portalId, item.name)))
      .then((next) => { if (current) setAdvice(next); })
      .catch((err) => { if (current) { setAdvice([]); setError(plainError(err)); } });
    window.tenderAssist.getPortalCategories(portalId, { includeProducts })
      .then((list) => { if (current) setWebsiteList(list.categories); })
      .catch(() => {});
    return () => { current = false; };
  }, [includeProducts, missing, portalId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (list: string[], value: string) => list.some((item) => sameName(item, value)) ? list.filter((item) => !sameName(item, value)) : [...list, value];
  const isPicked = (value: string) => picked.some((item) => sameName(item, value));
  const suggested = useMemo(() => new Set((advice ?? []).flatMap((entry) => entry.suggestions.map((suggestion) => suggestion.name.toLocaleLowerCase()))), [advice]);
  const query = filter.trim().toLocaleLowerCase();
  const others = websiteList.filter((name) =>
    !chosen.some((item) => sameName(item, name)) && !suggested.has(name.toLocaleLowerCase()) && (!query || name.toLocaleLowerCase().includes(query)));

  const title = missing.length === 1 ? `Replace “${missing[0].name}”` : `Replace ${missing.length} categories`;
  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="drawer__scrim" aria-label="Close" onClick={onClose} />
      <div className="drawer__panel">
        <header className="drawer__head">
          <h2>{title}</h2>
          <button type="button" className="btn btn--text btn--sm" onClick={onClose}><CrossIcon /> Close</button>
        </header>
        <div className="drawer__body replace">
          <p className="replace__intro">
            {portalName} no longer lists {missing.length === 1 ? 'this category' : 'these categories'}, so searches skip {missing.length === 1 ? 'it' : 'them'}.
            Pick one or more to search instead. Suggestions come first from where tenders you wanted were listed, then from new and similar names.
          </p>
          {error && <div className="alert alert--stop" role="alert"><p>{error}</p></div>}
          {!advice && <p className="replace__loading" aria-busy="true">Looking at past tenders…</p>}
          {advice?.map((entry, index) => {
            const item = missing[index];
            return (
              <section className="replace__group" key={item.name}>
                <h3>{item.name}</h3>
                <p className="replace__meta">
                  {missingSince(item)}.{' '}
                  {entry.missing.found > 0
                    ? `It brought ${entry.missing.found} ${entry.missing.found === 1 ? 'tender' : 'tenders'} before, ${entry.missing.wanted} you wanted.`
                    : 'No tender was found in it before.'}
                </p>
                {entry.suggestions.length === 0
                  ? <p className="replace__meta">No suggestion from past tenders or names. Find one below.</p>
                  : (
                    <ul className="replace__list">
                      {entry.suggestions.map((suggestion) => (
                        <li key={suggestion.name}>
                          <label className="replace__option">
                            <input type="checkbox" checked={isPicked(suggestion.name)} onChange={() => setPicked((list) => toggle(list, suggestion.name))} />
                            <span><strong>{suggestion.name}</strong><small>{suggestion.reasons.join(' · ')}</small></span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                <label className="replace__option replace__option--quiet">
                  <input type="checkbox" checked={remove.includes(item.name)} onChange={() => setRemove((list) => toggle(list, item.name))} />
                  <span>Stop searching “{item.name}”{item.longGone ? ' (gone two weeks or more)' : '. Leave this off and it is searched again if the website brings it back.'}</span>
                </label>
              </section>
            );
          })}

          <section className="replace__group">
            <h3>Any other category</h3>
            <input type="search" className="replace__find" value={filter} placeholder="Find a category" aria-label="Find a category" onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} />
            <ul className="replace__list replace__list--scroll">
              {others.slice(0, MAX_OTHERS).map((name) => (
                <li key={name}>
                  <label className="replace__option">
                    <input type="checkbox" checked={isPicked(name)} onChange={() => setPicked((list) => toggle(list, name))} />
                    <span><strong>{name}</strong></span>
                  </label>
                </li>
              ))}
              {others.length > MAX_OTHERS && <li className="pick-list__empty">{others.length - MAX_OTHERS} more. Type part of a name to find them.</li>}
              {others.length === 0 && <li className="pick-list__empty">{query ? 'No category matches that.' : 'Nothing else to add.'}</li>}
            </ul>
          </section>
        </div>
        <footer className="replace__foot">
          <button type="button" className="btn btn--text" onClick={onSkip}>Skip for now</button>
          <button type="button" className="btn btn--red" disabled={picked.length === 0 && remove.length === 0} onClick={() => onApply(picked, remove)}>
            {picked.length > 0 ? `Search ${picked.length} ${picked.length === 1 ? 'category' : 'categories'}` : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
