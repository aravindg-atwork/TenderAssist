import { useMemo, useState } from 'react';
import { CheckIcon, ChipRemoveIcon, PlusIcon } from './icons';
import { absoluteDateTime } from '../format';
import type { CategoryHealth, PortalCategoryList } from '../../../src/electron/ipcTypes';
import { missingSince } from './CategoryReplacement';
import { DEFAULT_RUN_DEFAULTS } from '../../../src/config/runConfiguration';

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
}

// GeM with products has thousands of categories; draw only the first ones and let typing narrow them.
const MAX_SHOWN = 150;

/**
 * GeM names run to hundreds of characters ("E-learning Content Development -
 * Non-igot; Restructure …; Hindi, English, …"). The part before the first
 * " - " or ";" is the name a person scans for; the rest is shown smaller.
 */
function splitCategory(value: string): { name: string; detail: string } {
  const match = /^(.{3,90}?)(?:\s+-\s+|;\s*)(.+)$/.exec(value);
  return match ? { name: match[1].trim(), detail: match[2].trim() } : { name: value, detail: '' };
}

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Categories to search, picked from the website's own Product Category list. */
export function CategoryPicker({ portalName, websiteList, values, onChange, startingList = DEFAULT_RUN_DEFAULTS.productCategories, unknownListHint, health, onReplace, onNewLooked }: CategoryPickerProps) {
  const [filter, setFilter] = useState('');
  const known = (websiteList?.categories.length ?? 0) > 0;
  const options = useMemo(() => {
    if (known) return websiteList!.categories;
    // Before the first search: the starting categories and anything already chosen.
    const list = [...startingList];
    for (const value of values) if (!list.some((item) => sameName(item, value))) list.push(value);
    return list;
  }, [known, websiteList, values, startingList]);

  const query = filter.trim().toLocaleLowerCase();
  const choices = options.filter((option) =>
    !values.some((value) => sameName(value, option)) && (!query || option.toLocaleLowerCase().includes(query)));
  // While searching, show matching categories already chosen too, so a search never looks empty for them.
  const chosenMatches = query ? values.filter((value) => value.toLocaleLowerCase().includes(query)) : [];
  const typed = filter.trim().replace(/\s+/g, ' ');
  // Typing a name is only offered until the website's list is known.
  const canAddTyped = !known && typed !== '' && !options.some((option) => sameName(option, typed));

  const newOnWebsite = (health?.newOnWebsite ?? []).filter((name) => !values.some((value) => sameName(value, name)));
  const missingInfo = (value: string) => health?.missing.find((item) => sameName(item.name, value));

  const add = (value: string) => {
    if (values.some((item) => sameName(item, value))) return;
    onChange([...values, value]);
    setFilter('');
  };

  return (
    <fieldset className="settings-fieldset">
      <legend>Categories to search <span className="count">{values.length}</span></legend>
      <p className="field-helper" id="category-picker-helper">
        {known
          ? `${portalName} only. ${websiteList!.categories.length} categories, read ${absoluteDateTime(websiteList!.readAt!)}.`
          : unknownListHint ?? `These are the starting categories. The full ${portalName} list appears here after one search.`}
      </p>
      <ul className="cat-list" aria-live="polite" aria-label="Chosen categories">
        {values.length === 0 && <li className="cat-list__empty">No categories chosen yet. Find one below.</li>}
        {values.map((value) => {
          const missing = known && !options.some((option) => sameName(option, value));
          const { name, detail } = splitCategory(value);
          const info = missing ? missingInfo(value) : undefined;
          const missingText = info ? (info.longGone ? 'Gone two weeks or more. Remove it?' : missingSince(info)) : 'Not on the website’s list';
          return (
            <li className={missing ? 'cat cat--missing' : 'cat'} key={value.toLocaleLowerCase()}
              title={missing ? `${value}\n\n${missingText}. Searches skip it until the website lists it again; replace it or remove it.` : value}>
              <span className="cat__text">
                <span className="cat__name">{name}</span>
                {missing ? <span className="cat__detail">{missingText}</span> : detail && <span className="cat__detail">{detail}</span>}
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
        <input id="product-category-entry" type="search" value={filter} placeholder="Find a category"
          aria-describedby="category-picker-helper" aria-controls="category-picker-options"
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (choices.length === 1) add(choices[0]);
            else if (choices.length === 0 && canAddTyped) add(typed);
          }} />
      </div>
      <ul className="pick-list" id="category-picker-options" aria-label="Categories you can add">
        {chosenMatches.map((value) => (
          <li key={`chosen-${value}`} className="pick-list__chosen">
            <span aria-hidden="true"><CheckIcon /></span> {value} <small>chosen</small>
          </li>
        ))}
        {choices.slice(0, MAX_SHOWN).map((option) => (
          <li key={option}>
            <button type="button" className="pick-list__item" onClick={() => add(option)} title={option}>
              <span aria-hidden="true"><PlusIcon /></span>
              <span className="pick-list__text"><strong>{splitCategory(option).name}</strong>{splitCategory(option).detail && <small>{splitCategory(option).detail}</small>}</span>
            </button>
          </li>
        ))}
        {canAddTyped && (
          <li>
            <button type="button" className="pick-list__item" onClick={() => add(typed)}>
              <span aria-hidden="true"><PlusIcon /></span> Add “{typed}” as typed
            </button>
          </li>
        )}
        {choices.length > MAX_SHOWN && (
          <li className="pick-list__empty">{choices.length - MAX_SHOWN} more. Type part of a name to find them.</li>
        )}
        {choices.length === 0 && !canAddTyped && chosenMatches.length === 0 && (
          <li className="pick-list__empty">{query ? 'No category matches that.' : 'Every category is already chosen.'}</li>
        )}
      </ul>
    </fieldset>
  );
}
