import { useMemo, useState } from 'react';
import { ChipRemoveIcon } from './icons';
import { absoluteDateTime } from '../format';
import type { PortalCategoryList } from '../../../src/electron/ipcTypes';
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
}

// GeM with products has thousands of categories; draw only the first ones and let typing narrow them.
const MAX_SHOWN = 150;

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Categories to search, picked from the website's own Product Category list. */
export function CategoryPicker({ portalName, websiteList, values, onChange, startingList = DEFAULT_RUN_DEFAULTS.productCategories, unknownListHint }: CategoryPickerProps) {
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

  const add = (value: string) => {
    if (values.some((item) => sameName(item, value))) return;
    onChange([...values, value]);
    setFilter('');
  };

  return (
    <fieldset className="settings-fieldset">
      <legend>Categories to search</legend>
      <p className="field-helper" id="category-picker-helper">
        {known
          ? `Pick from the ${websiteList!.categories.length} categories on the ${portalName} website (list read ${absoluteDateTime(websiteList!.readAt!)}).`
          : unknownListHint ?? `These are the starting categories. The full ${portalName} list appears here after one search.`}
      </p>
      <div className="chip-list" aria-live="polite">
        {values.map((value) => {
          const missing = known && !options.some((option) => sameName(option, value));
          return (
            <span className={missing ? 'chip chip--missing' : 'chip'} key={value.toLocaleLowerCase()}
              title={missing ? 'Not on the website’s list. This search will fail; remove it or pick the right name.' : undefined}>
              <span>{value}{missing && ' (not on the website)'}</span>
              <button type="button" className="chip__remove" aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((item) => item !== value))}>
                <ChipRemoveIcon />
              </button>
            </span>
          );
        })}
      </div>
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
            <span aria-hidden="true">✓</span> {value} <small>chosen</small>
          </li>
        ))}
        {choices.slice(0, MAX_SHOWN).map((option) => (
          <li key={option}>
            <button type="button" className="pick-list__item" onClick={() => add(option)}>
              <span aria-hidden="true">+</span> {option}
            </button>
          </li>
        ))}
        {canAddTyped && (
          <li>
            <button type="button" className="pick-list__item" onClick={() => add(typed)}>
              <span aria-hidden="true">+</span> Add “{typed}” as typed
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
