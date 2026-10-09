/// <reference lib="dom" />
import type { Locator, Page } from 'playwright-core';
import { isAuthenticatedDashboard } from './authDetector.js';
import type { PaceAction } from '../orchestration/actionPacer.js';

const noPacing: PaceAction = async () => {};

export interface PortalCredentials {
  loginId: string;
  password: string;
}

export type AssistedLoginStep =
  | 'ALREADY_AUTHENTICATED'
  | 'LOGIN_REQUIRED'
  | 'CAPTCHA_REQUIRED'
  | 'LOGIN_FORM_NOT_FOUND';

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

async function findPassword(page: Page): Promise<Locator | null> {
  return firstVisible([
    page.getByLabel(/password/i),
    page.locator('input[type="password"]'),
  ]);
}

async function openLoginForm(page: Page, paceAction: PaceAction): Promise<void> {
  if (await findPassword(page)) return;
  // Never a "DSC Login" control: that starts the signer, not the login form.
  const loginControl = await firstVisible([
    page.getByText(/click here to login/i, { exact: false }),
    page.getByRole('link', { name: /^(?!.*\bdsc\b).*\blogin\b/i }),
    page.locator('a:has(img[title*="login" i]):not(:has(img[title*="dsc" i])), input[title*="login" i]:not([title*="dsc" i])'),
  ]);
  if (!loginControl) return;
  await paceAction();
  await loginControl.click();
  await page.waitForLoadState('load').catch(() => {});
}

async function findLoginId(page: Page, password: Locator): Promise<Locator | null> {
  const labelled = await firstVisible([
    page.getByLabel(/login\s*id/i),
    page.getByLabel(/user\s*(?:name|id)/i),
    page.locator('input[name*="login" i], input[id*="login" i], input[name*="user" i], input[id*="user" i]'),
  ]);
  if (labelled) return labelled;

  const form = password.locator('xpath=ancestor::form[1]');
  if ((await form.count()) === 0) return null;
  return firstVisible([
    form.locator('input[type="text"]:not([name*="captcha" i]):not([id*="captcha" i])'),
    form.locator('input:not([type]):not([name*="captcha" i]):not([id*="captcha" i])'),
  ]);
}

async function findCaptcha(page: Page, password: Locator): Promise<Locator | null> {
  const direct = await firstVisible([
    page.getByLabel(/captcha\s*(?:text)?/i),
    page.locator('input[name*="captcha" i], input[id*="captcha" i]'),
  ]);
  if (direct) return direct;

  const form = password.locator('xpath=ancestor::form[1]');
  if ((await form.count()) === 0) return null;
  const textInputs = form.locator('input[type="text"], input:not([type])');
  const count = await textInputs.count();
  return count > 1 ? textInputs.nth(count - 1) : null;
}

/**
 * Opens the portal's own login form and optionally fills credentials. It
 * deliberately does not fill CAPTCHA or submit the form.
 */
/** Puts text in a field: all at once, or one key at a time (`typeLikeAPerson`). */
export type TypeText = (field: Locator, text: string) => Promise<void>;

export const typeAllAtOnce: TypeText = (field, text) => field.fill(text);

/**
 * Types one key at a time, the way a person does: about 70–220 ms between
 * keys and, now and then, a longer pause. Separate from the pause between
 * clicks. Used for the login ID and password; the CAPTCHA is always typed
 * by the operator.
 */
export function typeLikeAPerson(random: () => number = Math.random, wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): TypeText {
  return async (field, text) => {
    await field.fill('');
    await field.focus();
    for (const character of text) {
      await field.pressSequentially(character);
      await wait(70 + Math.round(random() * 150) + (random() < 0.08 ? 250 + Math.round(random() * 350) : 0));
    }
  };
}

export async function preparePortalLogin(
  page: Page,
  credentials?: PortalCredentials,
  paceAction: PaceAction = noPacing,
  typeText: TypeText = typeAllAtOnce
): Promise<AssistedLoginStep> {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (isAuthenticatedDashboard(bodyText)) return 'ALREADY_AUTHENTICATED';

  await openLoginForm(page, paceAction);
  const password = await findPassword(page);
  if (!password) return 'LOGIN_FORM_NOT_FOUND';
  if (!credentials) return 'LOGIN_REQUIRED';

  const loginId = await findLoginId(page, password);
  if (!loginId) return 'LOGIN_FORM_NOT_FOUND';

  await paceAction();
  await typeText(loginId, credentials.loginId);
  await paceAction();
  await typeText(password, credentials.password);
  const captcha = await findCaptcha(page, password);
  if (captcha) await captcha.focus();
  return 'CAPTCHA_REQUIRED';
}

/**
 * Refills only an already-visible login form. This deliberately never clicks
 * a generic Login link, so it is safe to call while polling the DSC flow.
 * Returns true only when at least one saved field had to be restored.
 */
export async function refillVisiblePortalLogin(page: Page, credentials: PortalCredentials, paceAction: PaceAction = noPacing, typeText: TypeText = typeAllAtOnce): Promise<boolean> {
  const password = await findPassword(page);
  if (!password) return false;
  const loginId = await findLoginId(page, password);
  if (!loginId) return false;

  let changed = false;
  if ((await loginId.inputValue().catch(() => '')).trim() !== credentials.loginId) {
    await paceAction();
    await typeText(loginId, credentials.loginId);
    changed = true;
  }
  if ((await password.inputValue().catch(() => '')) !== credentials.password) {
    await paceAction();
    await typeText(password, credentials.password);
    changed = true;
  }
  if (changed) {
    const captcha = await findCaptcha(page, password);
    if (captcha) await captcha.focus();
  }
  return changed;
}
