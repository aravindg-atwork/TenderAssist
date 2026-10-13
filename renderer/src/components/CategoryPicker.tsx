import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { InfoTip } from './InfoTip';
import { CheckIcon, ChipRemoveIcon, PlusIcon } from './icons';
import { absoluteDateTime } from '../format';
import type { CategoryHealth, GemCategoryCounts, PortalCategoryList } from '../../../src/electron/ipcTypes';
import { missingSince } from './CategoryReplacement';
import { DEFAULT_RUN_DEFAULTS } from '../../../src/config/runConfiguration';
import { matchRank, rankCategories, splitCategory } from '../categorySearch';

export interface CategoryPickerProps {
  portalName: string;
  /** The website's own list; empty until a search has read it. */
  websiteList: PortalCategoryList | null;
  values: string[];
  onChange: (values: string[]) => void;
  /** Shown until the website's list is known. Defaults to the GePNIC starting categories. */
  startingList?: readonly string[];
  /** Said while the website's list is not known yet. */
  unknownListHint?: string;
  /** Since when chosen categories are off the website's list, and what is new on it. */
  health?: CategoryHealth | null;
  /** Open the replacement picker for these dropped categories. */
  onReplace?: (names: string[]) => void;
  /** The operator has seen the new categories. */
  onNewLooked?: () => void;
  /** What categories are for, behind an (i) beside the heading. */
  info?: ReactNode;
  /** How a chosen name is matched to the website's list; GeM ignores its changing example after " - ". */
  keyOf?: (name: string) => string;
  /** GeM: how busy categories are (open now, and in recent runs). */
  countsFor?: (names: string[]) => Promise<GemCategoryCounts>;
}

// GeM's list has about 14,000 categories; draw only the best matches and let typing narrow them.
const MAX_SHOWN = 200;
/** Matches whose counts are asked for while searching, so GeM is asked only a little at a time. */
const COUNTED_MATCHES = 12;

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

type Kind = 'all' | 'service' | 'product';

function CountLine({ open, recent, recentDays }: { open: number | null | undefined; recent: number | undefined; recentDays: number | null }) {
  if (open === undefined && recent === undefined) return null;
  const parts: string[] = [];
  if (open === undefined) parts.push('counting…');
  else if (open !== null) parts.push(`${open.toLocaleString('en-IN')} open now`);
  if (recent !== undefined && recentDays) parts.push(`${recent.toLocaleString('en-IN')} in your last ${recentDays} searched ${recentDays === 1 ? 'day' : 'days'}`);
  if (parts.length === 0) return null;
  return <span className={open === 0 ? 'cat__counts cat__counts--none' : 'cat__counts'}>{parts.join(' · ')}</span>;
}

/** Categories to search, picked from the website's own Product Category list. */
export function CategoryPicker({ portalName, websiteList, values, onChange, startingList = DEFAULT_RUN_DEFAULTS.productCategories, unknownListHint, health, onReplace, onNewLooked, info, keyOf, countsFor }: CategoryPickerProps) {
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const known = (websiteList?.categories.length ?? 0) > 0;
  const products = useMemo(() => new Set((websiteList?.productNames ?? []).map((name) => name.toLocaleLowerCase())), [websiteList]);
  const hasKinds = products.size > 0;
  const kindOf = useCallback((name: string): Kind => products.has(name.toLocaleLowerCase()) ? 'product' : 'service', [products]);
  const options = useMemo(() => {
    if (known) return websiteList!.categories;
    // Before the first search: the starting categories and anything already chosen.
    const list = [...startingList];
    for (const value of values) if (!list.some((item) => sameName(item, value))) list.push(value);
    return list;
  }, [known, websiteList, values, startingList]);

  const query = filter.trim();
  const choices = useMemo(() => {
    const chosen = new Set(values.map((value) => value.toLocaleLowerCase()));
    return rankCategories(options, query, (option) =>
      !chosen.has(option.toLocaleLowerCase()) && (!hasKinds || kind === 'all' || kindOf(option) === kind));
  }, [options, values, query, hasKinds, kind, kindOf]);
  // While searching, show matching categories already chosen too, so a search never looks empty for them.
  const chosenMatches = query ? values.filter((value) => matchRank(value, query) !== null) : [];
  const typed = query.replace(/\s+/g, ' ');
  // Typing a name is only offered until the website's list is known.
  const canAddTyped = !known && typed !== '' && !options.some((option) => sameName(option, typed));

  // Counts: asked once per name, kept while the picker is open.
  const [counts, setCounts] = useState<Record<string, { open: number | null | undefined; recent: number | undefined }>>({});
  const [recentDays, setRecentDays] = useState<number | null>(null);
  const asked = useRef(new Set<string>());
  const askCounts = useCallback((names: string[]) => {
    if (!countsFor) return;
    const fresh = names.filter((name) => !asked.current.has(name));
    if (fresh.length === 0) return;
    for (const name of fresh) asked.current.add(name);
    setCounts((current) => {
      const next = { ...current };
      for (const name of fresh) next[name] = { open: undefined, recent: next[name]?.recent };
      return next;
    });
    countsFor(fresh)
      .then((result) => {
        setRecentDays(result.recentDays);
        setCounts((current) => {
          const next = { ...current };
          for (const name of fresh) next[name] = { open: result.open[name] ?? null, recent: result.recent[name] ?? 0 };
          return next;
        });
      })
      .catch(() => {
        setCounts((current) => {
          const next = { ...current };
          for (const name of fresh) next[name] = { open: null, recent: undefined };
          return next;
        });
      });
  }, [countsFor]);

  useEffect(() => { if (known) askCounts(values); }, [known, values, askCounts]);
  // The top matches of a search, once typing pauses.
  useEffect(() => {
    if (!known || !query) return;
    const timer = window.setTimeout(() => askCounts(choices.slice(0, COUNTED_MATCHES)), 500);
    return () => window.clearTimeout(timer);
  }, [known, query, choices, askCounts]);

  const newOnWebsite = (health?.newOnWebsite ?? []).filter((name) => !values.some((value) => sameName(value, name)));
  const missingInfo = (value: string) => health?.missing.find((item) => sameName(item.name, value));

  const add = (value: string) => {
    if (values.some((item) => sameName(item, value))) return;
    onChange([...values, value]);
    setFilter('');
  };

  const kindTag = (name: string) => hasKinds && <span className={`cat__kind cat__kind--${kindOf(name)}`}>{kindOf(name) === 'product' ? 'Product' : 'Service'}</span>;

  return (
    <fieldset className="settings-fieldset">
      <legend>Categories to search <span className="count">{values.length}</span>{info && <InfoTip label="categories to search">{info}</InfoTip>}</legend>
      <p className="field-helper" id="category-picker-helper">
        {known
          ? `${portalName} only. ${websiteList!.categories.length.toLocaleString('en-IN')} categories${hasKinds ? ` (${(websiteList!.categories.length - products.size).toLocaleString('en-IN')} services, ${products.size.toLocaleString('en-IN')} products)` : ''}, read ${absoluteDateTime(websiteList!.readAt!)}.`
          : unknownListHint ?? `These are the starting categories. The full ${portalName} list appears here after one search.`}
        {hasKinds && ' Product bids are searched as soon as you choose a product category.'}
      </p>
      <ul className="cat-list" aria-live="polite" aria-label="Chosen categories">
        {values.length === 0 && <li className="cat-list__empty">No categories chosen yet. Find one below.</li>}
        {values.map((value) => {
          const missing = known && !options.some((option) => keyOf ? keyOf(option) === keyOf(value) : sameName(option, value));
          const { name, detail } = splitCategory(value);
          const info = missing ? missingInfo(value) : undefined;
          const missingText = info ? (info.longGone ? 'Gone two weeks or more. Remove it?' : missingSince(info)) : 'Not on the website’s list';
          const count = counts[value];
          return (
            <li className={missing ? 'cat cat--missing' : 'cat'} key={value.toLocaleLowerCase()}
              title={missing ? `${value}\n\n${missingText}. Searches skip it until the website lists it again; replace it or remove it.` : value}>
              <span className="cat__text">
                <span className="cat__name">{kindTag(value)}{name}</span>
                {missing ? <span className="cat__detail">{missingText}</span> : detail && <span className="cat__detail">{detail}</span>}
                {!missing && count && <CountLine open={count.open} recent={count.recent} recentDays={recentDays} />}
              </span>
              {missing && onReplace && (
                <button type="button" className="cat__replace" onClick={() => onReplace([value])}>Replace</button>
              )}
              <button type="button" className="chip__remove" aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((item) => item !== value))}>
                <ChipRemoveIcon />
              </button>
            </li>
          );
        })}
      </ul>
      {newOnWebsite.length > 0 && (
        <div className="new-cats" aria-live="polite">
          <div className="new-cats__head">
            <span><strong>New on the {portalName} list:</strong> {newOnWebsite.length} {newOnWebsite.length === 1 ? 'category' : 'categories'} since you last looked.</span>
            {onNewLooked && <button type="button" className="btn btn--text btn--sm" onClick={onNewLooked}>Seen them</button>}
          </div>
          <ul className="new-cats__list">
            {newOnWebsite.slice(0, 20).map((option) => (
              <li key={option}>
                <button type="button" className="btn btn--line btn--sm" onClick={() => add(option)} title={option}><PlusIcon /> {splitCategory(option).name}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="chip-entry">
        <input id="product-category-entry" type="search" value={filter} placeholder="Find a category: words in any order"
          aria-describedby="category-picker-helper" aria-controls="category-picker-options"
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (choices.length === 1) add(choices[0]);
            else if (choices.length === 0 && canAddTyped) add(typed);
          }} />
      </div>
      {hasKinds && (
        <div className="presets presets--sm" role="radiogroup" aria-label="Kind of category">
          {(['all', 'service', 'product'] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={kind === option} className={kind === option ? 'preset is-on' : 'preset'} onClick={() => setKind(option)}>
              {option === 'all' ? 'All' : option === 'service' ? 'Services' : 'Products'}
            </button>
          ))}
        </div>
      )}
      <ul className="pick-list" id="category-picker-options" aria-label="Categories you can add">
        {chosenMatches.map((value) => (
          <li key={`chosen-${value}`} className="pick-list__chosen">
            <span aria-hidden="true"><CheckIcon /></span> {value} <small>chosen</small>
          </li>
        ))}
        {choices.slice(0, MAX_SHOWN).map((option) => {
          const { name, detail } = splitCategory(option);
          const count = counts[option];
          return (
            <li key={option}>
              <button type="button" className="pick-list__item" onClick={() => add(option)} title={option}>
                <span aria-hidden="true"><PlusIcon /></span>
                <span className="pick-list__text">
                  <strong>{kindTag(option)}{name}</strong>
                  {detail && <small>{detail}</small>}
                  {count && <CountLine open={count.open} recent={count.recent} recentDays={recentDays} />}
                </span>
              </button>
            </li>
          );
        })}
        {canAddTyped && (
          <li>
            <button type="button" className="pick-list__item" onClick={() => add(typed)}>
              <span aria-hidden="true"><PlusIcon /></span> Add “{typed}” as typed
            </button>
          </li>
        )}
        {choices.length > MAX_SHOWN && (
          <li className="pick-list__empty">{(choices.length - MAX_SHOWN).toLocaleString('en-IN')} more. Type more of a name to narrow them.</li>
        )}
        {choices.length === 0 && !canAddTyped && chosenMatches.length === 0 && (
          <li className="pick-list__empty">{query ? 'No category matches that.' : known ? 'Every category is already chosen.' : `Type a category name to add it. The full ${portalName} list appears after your first search.`}</li>
        )}
      </ul>
    </fieldset>
  );
}
