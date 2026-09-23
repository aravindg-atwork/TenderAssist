/// <reference lib="dom" />
import type { Locator, Page } from 'playwright-core';
import type { PaceAction } from '../orchestration/actionPacer.js';

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

/**
 * Starts the portal-controlled DSC handoff after the human has completed the
 * normal login and CAPTCHA. This clicks only an actionable DSC Login control;
 * certificate choice, signer launch, consent, and PIN entry remain manual.
 */
export async function clickDscLoginIfAvailable(page: Page, paceAction: PaceAction = async () => {}): Promise<boolean> {
  const control = await firstVisible([
    page.getByRole('button', { name: /(?:dsc\s*login|login\s*(?:with|using)\s*dsc)/i }),
    page.getByRole('link', { name: /(?:dsc\s*login|login\s*(?:with|using)\s*dsc)/i }),
    page.locator('input[type="submit"][value*="DSC" i], input[type="button"][value*="DSC" i]'),
    page.locator('a:has(img[title*="DSC" i]), a:has(img[alt*="DSC" i]), button[title*="DSC" i]'),
  ]);
  if (!control) return false;
  await paceAction();
  await control.click();
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  return true;
}
