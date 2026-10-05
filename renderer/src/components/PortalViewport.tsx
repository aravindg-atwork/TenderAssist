import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PORTAL_ZOOM_PERCENT,
  MAX_PORTAL_ZOOM_PERCENT,
  MIN_PORTAL_ZOOM_PERCENT,
  stepPortalZoom,
} from '../../../src/persistence/repositories/displaySettingsRepository';
import { BackIcon, RefreshIcon } from './icons';

export interface PortalViewportProps {
  portalId: string;
  portalName: string;
  /** False hides the native portal view without reloading it (another tab, or a divider drag). */
  active?: boolean;
}

export function PortalViewport({ portalId, portalName, active = true }: PortalViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(DEFAULT_PORTAL_ZOOM_PERCENT);

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
          <button className="btn btn--tool" type="button" onClick={() => window.tenderAssist.portalGoBack()}><BackIcon /> Back</button>
          <button className="btn btn--tool" type="button" onClick={() => window.tenderAssist.portalReload()}><RefreshIcon /> Reload</button>
        </div>
      </div>
      <div ref={surfaceRef} className="portal__surface">
        {!active && <p className="portal__paused">The portal is still signed in. It comes back when you let go of the divider or return to this tab.</p>}
      </div>
    </section>
  );
}
