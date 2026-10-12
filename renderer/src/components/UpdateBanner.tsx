import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../../src/electron/updateService';
import { plainError } from '../words';

/** "1.2.3" → [1, 2, 3]. */
function versionParts(version: string | undefined): number[] {
  return (version ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);
}

/**
 * A new feature release (0.5 → 0.6, or 1.x → 2.0), not a small fix. Small
 * fixes install quietly when TenderAssist closes; feature releases are
 * announced on Today.
 */
export function isMajorUpdate(current: string, next: string | undefined): boolean {
  const [currentMajor, currentMinor] = versionParts(current);
  const [nextMajor, nextMinor] = versionParts(next);
  return nextMajor > currentMajor || (nextMajor === currentMajor && nextMinor > currentMinor);
}

/** On Today: a new version of TenderAssist is on its way, or ready to install with a restart. */
export function UpdateBanner({ running }: { running: boolean }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    window.tenderAssist.getUpdateStatus().then(setStatus).catch(() => {});
    return window.tenderAssist.onUpdateStatus(setStatus);
  }, []);

  if (!status || !isMajorUpdate(status.currentVersion, status.availableVersion)) return null;
  if (status.state !== 'AVAILABLE' && status.state !== 'DOWNLOADING' && status.state !== 'READY') return null;
  const version = status.availableVersion;

  return (
    <p className="notice notice--attention" role="status">
      {status.state === 'READY' ? (
        <>
          <strong>A new version of TenderAssist ({version}) is ready.</strong>{' '}
          {running ? 'Restart after this search to install it. Nothing is lost.' : 'Restart to install it. It takes under a minute; nothing is lost.'}{' '}
          {!running && (
            <button type="button" className="btn btn--primary btn--small"
              onClick={() => { window.tenderAssist.restartToInstallUpdate().catch((err) => setError(plainError(err))); }}>
              Restart and update
            </button>
          )}
        </>
      ) : (
        <>
          <strong>A new version of TenderAssist{version ? ` (${version})` : ''} is available.</strong>{' '}
          Downloading{status.progressPercent !== undefined ? ` (${status.progressPercent}%)` : ''}… You can keep working; you will be asked to restart when it is ready.
        </>
      )}
      {error && <> {error}</>}
    </p>
  );
}
