import { PORTALS, type PortalDefinition, type PortalGroup } from '../../../src/config/portalRegistry';

const GROUPS: PortalGroup[] = ['Central Government', 'PSU / Other', 'State / UT'];

export function PortalSelect({
  id,
  value,
  onChange,
  disabled = false,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (portalId: string) => void;
  disabled?: boolean;
  /** Shown while no website from the list is chosen. */
  placeholder?: string;
}) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {GROUPS.map((group) => (
        <optgroup label={group} key={group}>
          {PORTALS.filter((portal) => portal.group === group).map((portal) => (
            <option value={portal.id} key={portal.id}>
              {portal.name}{portal.compatibility === 'BETA' ? ' (beta)' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function PortalCompatibilityBadge({ portal }: { portal: PortalDefinition }) {
  return (
    <span className={`compatibility-badge compatibility-badge--${portal.compatibility.toLocaleLowerCase()}`}>
      {portal.compatibility === 'VERIFIED' ? 'Verified flow' : 'Beta flow'}
    </span>
  );
}
