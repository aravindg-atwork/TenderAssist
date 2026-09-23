import { describe, expect, it } from 'vitest';
import { DEFAULT_PORTAL_ID, PORTALS, getPortalDefinition, portalTargetPrefix } from '../../src/config/portalRegistry.js';

describe('portal registry', () => {
  it('contains the 48 official participating portals without duplicate IDs', () => {
    expect(PORTALS).toHaveLength(48);
    expect(new Set(PORTALS.map((portal) => portal.id)).size).toBe(48);
    expect(PORTALS.filter((portal) => portal.group === 'Central Government')).toHaveLength(4);
    expect(PORTALS.filter((portal) => portal.group === 'PSU / Other')).toHaveLength(12);
    expect(PORTALS.filter((portal) => portal.group === 'State / UT')).toHaveLength(32);
  });

  it('keeps Tamil Nadu as the verified backward-compatible default', () => {
    const portal = getPortalDefinition(DEFAULT_PORTAL_ID);
    expect(portal.name).toBe('Tamil Nadu');
    expect(portal.compatibility).toBe('VERIFIED');
    expect(portalTargetPrefix(portal)).toBe('https://tntenders.gov.in/nicgep');
  });

  it('accepts both NIC path families used by the official directory', () => {
    expect(new Set(PORTALS.map((portal) => new URL(portal.url).pathname))).toEqual(
      new Set(['/nicgep/app', '/eprocure/app'])
    );
  });
});
