import { describe, expect, it } from 'vitest';
import {
  clampGuideWidth,
  guideWidthForPreset,
  layoutModeFor,
  MIN_GUIDE_WIDTH,
  MIN_PORTAL_WIDTH,
  presetForWidth,
  suggestedFocus,
} from '../../src/ui/runLayout.js';

describe('run workspace layout', () => {
  it('uses a split view from 1120 px and tabs below it', () => {
    expect(layoutModeFor(1440)).toBe('split');
    expect(layoutModeFor(1120)).toBe('split');
    expect(layoutModeFor(1119)).toBe('tabs');
    expect(layoutModeFor(900)).toBe('tabs');
  });

  it('sizes the instruction panel for each preset within the allowed range', () => {
    expect(guideWidthForPreset('instructions', 1600)).toBe(720);
    expect(guideWidthForPreset('balanced', 1600)).toBe(560);
    expect(guideWidthForPreset('portal', 1600)).toBe(352);
    expect(guideWidthForPreset('portal', 1300)).toBe(MIN_GUIDE_WIDTH);
  });

  it('always leaves the portal at least 640 px', () => {
    expect(clampGuideWidth(900, 1200)).toBe(1200 - MIN_PORTAL_WIDTH);
    expect(guideWidthForPreset('instructions', 1200)).toBe(1200 - MIN_PORTAL_WIDTH);
    expect(clampGuideWidth(100, 1600)).toBe(MIN_GUIDE_WIDTH);
  });

  it('never lets the instruction panel go below its minimum on a cramped container', () => {
    expect(clampGuideWidth(500, 800)).toBe(MIN_GUIDE_WIDTH);
  });

  it('names the preset closest to a manual width, or none', () => {
    expect(presetForWidth(560, 1600)).toBe('balanced');
    expect(presetForWidth(470, 1600)).toBeNull();
  });

  it('suggests the portal when the operator must act there, and instructions otherwise', () => {
    expect(suggestedFocus({ phase: 'AUTH', authStep: 'CAPTCHA_REQUIRED' })).toBe('portal');
    expect(suggestedFocus({ phase: 'AUTH', authStep: 'LOGIN_REQUIRED' })).toBe('portal');
    expect(suggestedFocus({ phase: 'AUTH', authStep: 'DSC_READY' })).toBe('instructions');
    expect(suggestedFocus({ phase: 'SEARCH' })).toBe('balanced');
    expect(suggestedFocus({ phase: 'ACQUISITION', jobState: 'SESSION_EXPIRED' })).toBe('instructions');
    expect(suggestedFocus({ phase: 'CLASSIFICATION', jobState: 'SHORTLISTED' })).toBe('balanced');
    expect(suggestedFocus(null)).toBe('balanced');
  });
});
