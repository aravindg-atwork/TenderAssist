import type { Page } from 'playwright-core';

/**
 * Clicks the portal's real Logout link to cleanly end the server-side
 * session before the browser is closed, rather than just force-killing the
 * Chrome process (its Logout control is an <img title="Logout"> inside
 * <a id="logoutLink">, confirmed live). Best-effort: the caller is about to
 * close the browser regardless, so any failure here (tab already closed,
 * click doesn't register, page in some other state) is swallowed rather
 * than blocking that close.
 */
export async function attemptLogout(page: Page, timeoutMs = 5000): Promise<void> {
  if (page.isClosed()) return;
  try {
    await Promise.race([
      page.click('#logoutLink'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('logout click timed out')), timeoutMs)),
    ]);
    await page.waitForLoadState('load').catch(() => {});
  } catch {
    // Best-effort only -- the caller closes the browser either way.
  }
}
