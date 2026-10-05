import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  clampGuideWidth,
  guideWidthForPreset,
  layoutModeFor,
  MAX_GUIDE_WIDTH,
  MIN_GUIDE_WIDTH,
  suggestedFocus,
} from '../../../src/ui/runLayout';
import type { AuthJobUpdate } from '../../../src/electron/ipcTypes';
import { PortalViewport } from './PortalViewport';

const SPLIT_KEY = 'tenderassist.runPanelWidth';
const KEYBOARD_STEP = 24;

function readSavedWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}

export interface RunWorkspaceProps {
  guide: ReactNode;
  portalId: string;
  portalName: string;
  update: AuthJobUpdate | null;
}

/**
 * The run panel beside the embedded portal. Resizing only moves or hides
 * the portal view; it is never reloaded, so sign-in and downloads carry on.
 */
export function RunWorkspace({ guide, portalId, portalName, update }: RunWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [containerWidth, setContainerWidth] = useState(0);
  const [savedWidth, setSavedWidth] = useState<number | null>(readSavedWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [tab, setTab] = useState<'run' | 'portal'>('portal');
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

  // When the operator is needed in the portal, the narrow view shows it.
  const focus = suggestedFocus(update);
  useEffect(() => {
    if (mode === 'tabs') setTab(focus === 'instructions' ? 'run' : 'portal');
  }, [focus, mode]);

  const width = containerWidth === 0
    ? MIN_GUIDE_WIDTH
    : clampGuideWidth(dragWidth ?? savedWidth ?? guideWidthForPreset('balanced', containerWidth), containerWidth);

  const save = (next: number) => {
    setSavedWidth(next);
    try { localStorage.setItem(SPLIT_KEY, String(next)); } catch { /* applies for this session */ }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragWidth(width);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragWidth === null || !containerRef.current) return;
    setDragWidth(clampGuideWidth(event.clientX - containerRef.current.getBoundingClientRect().left, containerWidth));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragWidth === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    save(dragWidth);
    setDragWidth(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? width - KEYBOARD_STEP
      : event.key === 'ArrowRight' ? width + KEYBOARD_STEP
        : event.key === 'Home' ? MIN_GUIDE_WIDTH
          : event.key === 'End' ? MAX_GUIDE_WIDTH : null;
    if (next === null) return;
    event.preventDefault();
    save(clampGuideWidth(next, containerWidth));
  };

  if (mode === 'tabs') {
    return (
      <div ref={containerRef} className="workspace workspace--tabs">
        <div className="workspace__tabs" role="tablist" aria-label="Search">
          <button type="button" role="tab" aria-selected={tab === 'run'} className="workspace__tab" onClick={() => setTab('run')}>What to do</button>
          <button type="button" role="tab" aria-selected={tab === 'portal'} className="workspace__tab" onClick={() => setTab('portal')}>
            Portal{focus === 'portal' && tab !== 'portal' ? ' · needs you' : ''}
          </button>
        </div>
        <div className="workspace__panel" hidden={tab !== 'run'}>{guide}</div>
        <div className="workspace__panel workspace__panel--portal" hidden={tab !== 'portal'}>
          <PortalViewport portalId={portalId} portalName={portalName} active={tab === 'portal'} />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={dragWidth !== null ? 'workspace is-resizing' : 'workspace'} style={{ gridTemplateColumns: `${width}px 10px minmax(0, 1fr)` }}>
      <div className="workspace__guide">{guide}</div>
      <div
        className="workspace__divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the panel and the portal"
        aria-valuemin={MIN_GUIDE_WIDTH}
        aria-valuemax={MAX_GUIDE_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      />
      {/* The native portal view would swallow the drag, so it is hidden (not reloaded) while dragging. */}
      <PortalViewport portalId={portalId} portalName={portalName} active={dragWidth === null} />
    </div>
  );
}
