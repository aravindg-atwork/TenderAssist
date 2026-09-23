import { useEffect, useRef } from 'react';

export interface PortalViewportProps {
  portalName: string;
}

export function PortalViewport({ portalName }: PortalViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

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
  }, []);

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
          <button className="btn btn-secondary" type="button" onClick={() => window.tenderAssist.portalGoBack()}>
            Back
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => window.tenderAssist.portalReload()}>
            Reload
          </button>
        </div>
      </div>
      <div ref={surfaceRef} className="portal-viewport__surface" />
    </section>
  );
}
