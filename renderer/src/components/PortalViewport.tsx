import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PORTAL_ZOOM_PERCENT,
  MAX_PORTAL_ZOOM_PERCENT,
  MIN_PORTAL_ZOOM_PERCENT,
  stepPortalZoom,
} from '../../../src/persistence/repositories/displaySettingsRepository';
import { BackIcon, KeyIcon, RefreshIcon } from './icons';

export interface PortalViewportProps {
  portalId: string;
  portalName: string;
  /** False hides the native portal view without reloading it (another tab, or a divider drag). */
  active?: boolean;
}

export function PortalViewport({ portalId, portalName, active = true }: PortalViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(DEFAULT_PORTAL_ZOOM_PERCENT);
  // While the run drives the portal, the operator's clicks are held back;
  // taking control is a deliberate two-step action, and can be undone.
  const [lock, setLock] = useState<{ locked: boolean; overridden: boolean }>({ locked: false, overridden: false });
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    window.tenderAssist.getPortalLock().then(setLock).catch(() => {});
    return window.tenderAssist.onPortalLock((next) => { setLock(next); if (!next.locked) setConfirming(false); });
  }, []);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 5_000);
    return () => clearTimeout(timer);
  }, [confirming]);
  const takeControl = (take: boolean) => {
    setConfirming(false);
    window.tenderAssist.setPortalControl(take).then(setLock).catch(console.error);
  };

  useEffect(() => {
    window.tenderAssist.getPortalZoom(portalId).then(setZoom).catch(console.error);
  }, [portalId]);

  const applyZoom = (percent: number) => {
    window.tenderAssist.setPortalZoom(portalId, percent).then(setZoom).catch(console.error);
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !active) {
      void window.tenderAssist.setPortalVisible(false);
      return;
    }

    let frame = 0;
    const syncBounds = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = surface.getBoundingClientRect();
        void window.tenderAssist.setPortalBounds({
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        });
      });
    };

    const observer = new ResizeObserver(syncBounds);
    observer.observe(surface);
    window.addEventListener('resize', syncBounds);
    window.addEventListener('scroll', syncBounds, true);
    void window.tenderAssist.setPortalVisible(true);
    syncBounds();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
      window.removeEventListener('scroll', syncBounds, true);
      void window.tenderAssist.setPortalVisible(false);
    };
  }, [active]);

  return (
    <section className="portal" aria-label={`${portalName} portal`}>
      <div className="portal__bar">
        <span className="portal__name"><span className="portal__live" aria-hidden="true" />{portalName}</span>
        {lock.locked && (
          <span className="portal__lock" role="status">
            <span className="portal__lock-text">Clicks paused while TenderAssist works</span>
            <button type="button" className={confirming ? 'btn btn--sm btn--warn' : 'btn btn--sm btn--line'}
              onClick={() => (confirming ? takeControl(true) : setConfirming(true))}>
              <KeyIcon /> {confirming ? 'Click again: it can interrupt the run' : 'Let me use the portal'}
            </button>
          </span>
        )}
        {lock.overridden && (
          <span className="portal__lock portal__lock--yours" role="status">
            <span className="portal__lock-text">You have control. Clicks can interrupt the run.</span>
            <button type="button" className="btn btn--sm btn--primary" onClick={() => takeControl(false)}>Hand back</button>
          </span>
        )}
        <div className="portal__tools">
          <div className="zoom" role="group" aria-label="Portal zoom">
            <button className="btn btn--tool" type="button" onClick={() => applyZoom(stepPortalZoom(zoom, -1))}
              disabled={zoom <= MIN_PORTAL_ZOOM_PERCENT} aria-label="Make the portal smaller">−</button>
            <button className="btn btn--tool zoom__value" type="button" onClick={() => applyZoom(DEFAULT_PORTAL_ZOOM_PERCENT)}
              title="Reset the portal to 100%" aria-label={`Portal zoom ${zoom}%. Reset to 100%`}>
              <span aria-live="polite">{zoom}%</span>
            </button>
            <button className="btn btn--tool" type="button" onClick={() => applyZoom(stepPortalZoom(zoom, 1))}
              disabled={zoom >= MAX_PORTAL_ZOOM_PERCENT} aria-label="Make the portal larger">+</button>
          </div>
          <button className="btn btn--tool" type="button" disabled={lock.locked} title={lock.locked ? 'Paused while TenderAssist works' : undefined} onClick={() => window.tenderAssist.portalGoBack()}><BackIcon /> Back</button>
          <button className="btn btn--tool" type="button" disabled={lock.locked} title={lock.locked ? 'Paused while TenderAssist works' : undefined} onClick={() => window.tenderAssist.portalReload()}><RefreshIcon /> Reload</button>
        </div>
      </div>
      <div ref={surfaceRef} className="portal__surface">
        {!active && <p className="portal__paused">The portal is still signed in. It comes back when you let go of the divider or return to this tab.</p>}
      </div>
    </section>
  );
}
