import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  clampGuideWidth,
  guideWidthForPreset,
  layoutModeFor,
  MAX_GUIDE_WIDTH,
  MIN_GUIDE_WIDTH,
  presetForWidth,
  RUN_FOCUS_PRESETS,
  suggestedFocus,
  type RunFocusPreset,
} from '../../../src/ui/runLayout';
import type { AuthJobUpdate } from '../../../src/electron/ipcTypes';
import { PortalViewport } from './PortalViewport';

const SPLIT_KEY = 'tenderassist.runSplit';
const AUTO_FOCUS_KEY = 'tenderassist.autoFocus';
const KEYBOARD_STEP = 24;

const PRESET_LABELS: Record<RunFocusPreset, { label: string; hint: string }> = {
  instructions: { label: 'Instructions', hint: 'More room to read guidance and review' },
  balanced: { label: 'Balanced', hint: 'Normal operation' },
  portal: { label: 'Portal', hint: 'More room for CAPTCHA, forms and portal pages' },
};

type SavedSplit = { preset: RunFocusPreset } | { width: number };

function readSavedSplit(): SavedSplit | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SPLIT_KEY) ?? 'null') as SavedSplit | null;
    if (parsed && 'preset' in parsed && RUN_FOCUS_PRESETS.includes(parsed.preset)) return parsed;
    if (parsed && 'width' in parsed && Number.isFinite(parsed.width)) return parsed;
  } catch { /* fall back to the default split */ }
  return null;
}

function saveSplit(split: SavedSplit): void {
  try { localStorage.setItem(SPLIT_KEY, JSON.stringify(split)); } catch { /* the split still applies for this run */ }
}

function readAutoFocus(): boolean {
  try { return localStorage.getItem(AUTO_FOCUS_KEY) === 'true'; } catch { return false; }
}

/** Larger text needs a wider instruction panel on mid-size screens. */
function defaultPreset(): RunFocusPreset {
  const largeText = (document.documentElement.dataset.textSize ?? 'standard') !== 'standard';
  return largeText && window.innerWidth < 1440 ? 'instructions' : 'balanced';
}

export interface RunWorkspaceProps {
  guide: ReactNode;
  portalId: string;
  portalName: string;
  update: AuthJobUpdate | null;
}

/**
 * The instruction panel beside the embedded portal. Resizing, presets, and
 * tabs only move or hide the portal view; the portal is never reloaded, so
 * sign-in, automation, and downloads carry on.
 */
export function RunWorkspace({ guide, portalId, portalName, update }: RunWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [containerWidth, setContainerWidth] = useState(0);
  const [split, setSplit] = useState<SavedSplit>(() => readSavedSplit() ?? { preset: defaultPreset() });
  const [tab, setTab] = useState<'instructions' | 'portal'>('portal');
  const [dragging, setDragging] = useState(false);
  const [autoFocus, setAutoFocus] = useState(readAutoFocus);
  const mode = layoutModeFor(windowWidth);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(container);
    setContainerWidth(container.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const guideWidth = containerWidth === 0
    ? MIN_GUIDE_WIDTH
    : 'preset' in split
      ? guideWidthForPreset(split.preset, containerWidth)
      : clampGuideWidth(split.width, containerWidth);
  const activePreset = 'preset' in split ? split.preset : presetForWidth(guideWidth, containerWidth);

  const choose = (next: SavedSplit) => {
    setSplit(next);
    saveSplit(next);
  };

  // Optional automatic focus: move attention only when the task changes,
  // so a manual choice stands until the next step.
  const suggestion = suggestedFocus(update);
  useEffect(() => {
    if (!autoFocus) return;
    if (mode === 'split') setSplit({ preset: suggestion });
    else if (suggestion !== 'balanced') setTab(suggestion);
  }, [suggestion, autoFocus, mode]);

  const toggleAutoFocus = (enabled: boolean) => {
    setAutoFocus(enabled);
    try { localStorage.setItem(AUTO_FOCUS_KEY, String(enabled)); } catch { /* applies for this session */ }
  };

  const onDividerPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onDividerPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !containerRef.current) return;
    const left = containerRef.current.getBoundingClientRect().left;
    setSplit({ width: clampGuideWidth(event.clientX - left, containerWidth) });
  };
  const onDividerPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    saveSplit({ width: guideWidth });
  };
  const onDividerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? guideWidth - KEYBOARD_STEP
      : event.key === 'ArrowRight' ? guideWidth + KEYBOARD_STEP
        : event.key === 'Home' ? MIN_GUIDE_WIDTH
          : event.key === 'End' ? MAX_GUIDE_WIDTH
            : null;
    if (next === null) return;
    event.preventDefault();
    choose({ width: clampGuideWidth(next, containerWidth) });
  };

  const focusControls = mode === 'split' ? (
    <div className="run-focus" role="group" aria-label="Screen layout">
      <span className="run-focus__label">Layout</span>
      <div className="run-focus__options">
        {RUN_FOCUS_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={activePreset === preset ? 'run-focus__option is-active' : 'run-focus__option'}
            aria-pressed={activePreset === preset}
            title={PRESET_LABELS[preset].hint}
            onClick={() => choose({ preset })}
          >
            {PRESET_LABELS[preset].label}
          </button>
        ))}
      </div>
      <label className="run-focus__auto">
        <input type="checkbox" checked={autoFocus} onChange={(event) => toggleAutoFocus(event.target.checked)} />
        Automatically focus the current task
      </label>
    </div>
  ) : null;

  if (mode === 'tabs') {
    return (
      <div ref={containerRef} className="running-workspace running-workspace--tabs">
        <div className="run-tabs" role="tablist" aria-label="Run workspace">
          {(['instructions', 'portal'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`run-tab-${value}`}
              aria-selected={tab === value}
              aria-controls={`run-panel-${value}`}
              className={tab === value ? 'run-tabs__tab is-active' : 'run-tabs__tab'}
              onClick={() => setTab(value)}
            >
              {value === 'instructions' ? 'Instructions' : 'Tender portal'}
              {value === 'portal' && suggestion === 'portal' && tab !== 'portal' && <span className="run-tabs__attention"> · action needed</span>}
            </button>
          ))}
          <label className="run-focus__auto">
            <input type="checkbox" checked={autoFocus} onChange={(event) => toggleAutoFocus(event.target.checked)} />
            Automatically focus the current task
          </label>
        </div>
        <div id="run-panel-instructions" role="tabpanel" aria-labelledby="run-tab-instructions" className="run-tabs__panel" hidden={tab !== 'instructions'}>
          {guide}
          <p className="run-tabs__note">The portal stays signed in and keeps working while you read this.</p>
        </div>
        <div id="run-panel-portal" role="tabpanel" aria-labelledby="run-tab-portal" className="run-tabs__panel run-tabs__panel--portal" hidden={tab !== 'portal'}>
          <PortalViewport portalId={portalId} portalName={portalName} active={tab === 'portal'} />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={dragging ? 'running-workspace running-workspace--split is-resizing' : 'running-workspace running-workspace--split'}
      style={{ gridTemplateColumns: `${guideWidth}px 12px minmax(0, 1fr)` }}
    >
      <div className="run-guide">
        {focusControls}
        {guide}
      </div>
      <div
        className="run-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize instructions and portal"
        aria-valuemin={MIN_GUIDE_WIDTH}
        aria-valuemax={MAX_GUIDE_WIDTH}
        aria-valuenow={guideWidth}
        tabIndex={0}
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
        onPointerCancel={onDividerPointerUp}
        onKeyDown={onDividerKeyDown}
      />
      {/* The native portal view sits above the page and would swallow the
          drag, so it is hidden (not reloaded) until the divider is released. */}
      <PortalViewport portalId={portalId} portalName={portalName} active={!dragging} />
    </div>
  );
}
