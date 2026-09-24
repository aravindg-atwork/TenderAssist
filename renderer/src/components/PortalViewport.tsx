import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PORTAL_ZOOM_PERCENT,
  MAX_PORTAL_ZOOM_PERCENT,
  MIN_PORTAL_ZOOM_PERCENT,
  stepPortalZoom,
} from '../../../src/persistence/repositories/displaySettingsRepository';

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
    <section className="portal-workspace" aria-label={`${portalName} workspace`}>
      <div className="portal-toolbar">
        <div className="portal-toolbar__identity">
          <span className="portal-live-dot" aria-hidden="true" />
          <div>
            <strong>{portalName}</strong>
            <span>Secure embedded session</span>
          </div>
        </div>
        <div className="portal-toolbar__actions">
          <div className="portal-zoom" role="group" aria-label="Portal zoom">
            <button
              className="btn btn-secondary portal-zoom__step"
              type="button"
              onClick={() => applyZoom(stepPortalZoom(zoom, -1))}
              disabled={zoom <= MIN_PORTAL_ZOOM_PERCENT}
              aria-label="Make portal smaller"
            >
              −
            </button>
            <button
              className="btn btn-secondary portal-zoom__value"
              type="button"
              onClick={() => applyZoom(DEFAULT_PORTAL_ZOOM_PERCENT)}
              title="Reset portal zoom to 100%"
              aria-label={`Portal zoom ${zoom}%. Reset to 100%`}
            >
              <span aria-live="polite">{zoom}%</span>
            </button>
            <button
              className="btn btn-secondary portal-zoom__step"
              type="button"
              onClick={() => applyZoom(stepPortalZoom(zoom, 1))}
              disabled={zoom >= MAX_PORTAL_ZOOM_PERCENT}
              aria-label="Make portal larger"
            >
              +
            </button>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => window.tenderAssist.portalGoBack()}>
            Back
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => window.tenderAssist.portalReload()}>
            Reload
          </button>
        </div>
      </div>
      <div ref={surfaceRef} className="portal-viewport__surface">
        {!active && <p className="portal-viewport__paused">The portal is still signed in. It will reappear when you release the divider or return to this tab.</p>}
      </div>
    </section>
  );
}
