import { describe, expect, it } from 'vitest';
import { DEFAULT_PORTAL_ID, PORTALS, getPortalDefinition, isGemPortal, portalTargetPrefix } from '../../src/config/portalRegistry.js';

const GEPNIC = PORTALS.filter((portal) => !isGemPortal(portal));

describe('portal registry', () => {
  it('contains the 48 official participating portals without duplicate IDs', () => {
    expect(GEPNIC).toHaveLength(48);
    expect(new Set(PORTALS.map((portal) => portal.id)).size).toBe(PORTALS.length);
    expect(GEPNIC.filter((portal) => portal.group === 'Central Government')).toHaveLength(4);
    expect(GEPNIC.filter((portal) => portal.group === 'PSU / Other')).toHaveLength(12);
    expect(GEPNIC.filter((portal) => portal.group === 'State / UT')).toHaveLength(32);
  });

  it('keeps Tamil Nadu as the verified backward-compatible default', () => {
    const portal = getPortalDefinition(DEFAULT_PORTAL_ID);
    expect(portal.name).toBe('Tamil Nadu');
    expect(portal.compatibility).toBe('VERIFIED');
    expect(isGemPortal(portal)).toBe(false);
    expect(portalTargetPrefix(portal)).toBe('https://tntenders.gov.in/nicgep');
  });

  it('accepts both NIC path families used by the official directory', () => {
    expect(new Set(GEPNIC.map((portal) => new URL(portal.url).pathname))).toEqual(
      new Set(['/nicgep/app', '/eprocure/app'])
    );
  });

  it('lists GeM as its own kind of website, searched without sign-in', () => {
    const gem = getPortalDefinition('gem');
    expect(isGemPortal(gem)).toBe(true);
    expect(gem.group).toBe('Central Government');
    expect(new URL(gem.url).hostname).toBe('bidplus.gem.gov.in');
  });
});
