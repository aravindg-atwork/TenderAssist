import { describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { refillVisiblePortalLogin, typeAllAtOnce, typeLikeAPerson } from '../../src/browser/portalLoginController.js';

function fakeField() {
  const calls: string[] = [];
  const field = {
    fill: async (text: string) => { calls.push(`fill:${text}`); },
    focus: async () => { calls.push('focus'); },
    pressSequentially: async (text: string) => { calls.push(`key:${text}`); },
  } as unknown as Locator;
  return { field, calls };
}

/** A login form whose boxes hold what was typed, or what the portal's own script put there. */
function fakeLoginPage(values: { login: string; password: string }) {
  const typed: string[] = [];
  const box = (name: 'login' | 'password' | 'captcha') => {
    const locator = {
      count: async () => 1,
      nth: () => locator,
      isVisible: async () => true,
      inputValue: async () => (name === 'captcha' ? '' : values[name]),
      fill: async (text: string) => { typed.push(`${name}:${text}`); if (name !== 'captcha') values[name] = text; },
      focus: async () => {},
      locator: () => ({ count: async () => 0 }),
    };
    return locator;
  };
  const none = { count: async () => 0 };
  const page = {
    getByLabel: (label: RegExp) => (label.test('password') ? box('password') : label.test('login id') ? box('login') : label.test('captcha') ? box('captcha') : none),
    locator: () => none,
  } as unknown as Page;
  return { page, typed };
}

describe('filling the login form again while the operator types the CAPTCHA', () => {
  const credentials = { loginId: 'tenders@example.in', password: 'secret' };

  it('leaves a password box the portal changed alone, and fills it only when emptied', async () => {
    // Tamil Nadu's page changes the box's contents once the password is in.
    const form = fakeLoginPage({ login: credentials.loginId, password: '••••••••a1b2' });
    expect(await refillVisiblePortalLogin(form.page, credentials)).toBe(false);
    expect(await refillVisiblePortalLogin(form.page, credentials)).toBe(false);
    expect(form.typed).toEqual([]);

    // A wrong CAPTCHA clears the form: then both are filled again, once.
    const cleared = fakeLoginPage({ login: '', password: '' });
    expect(await refillVisiblePortalLogin(cleared.page, credentials)).toBe(true);
    expect(await refillVisiblePortalLogin(cleared.page, credentials)).toBe(false);
    expect(cleared.typed).toEqual(['login:tenders@example.in', 'password:secret']);
  });
});

describe('typing the login', () => {
  it('types one key at a time with a pause after each, like a person', async () => {
    const { field, calls } = fakeField();
    const waits: number[] = [];
    await typeLikeAPerson(() => 0.5, async (ms) => { waits.push(ms); })(field, 'ab1');
    expect(calls).toEqual(['fill:', 'focus', 'key:a', 'key:b', 'key:1']);
    expect(waits).toEqual([145, 145, 145]);
  });

  it('sometimes pauses longer, as people do', async () => {
    const { field } = fakeField();
    const waits: number[] = [];
    await typeLikeAPerson(() => 0.05, async (ms) => { waits.push(ms); })(field, 'x');
    expect(waits[0]).toBeGreaterThan(250);
  });

  it('can still put the text in all at once', async () => {
    const { field, calls } = fakeField();
    await typeAllAtOnce(field, 'sales@example.com');
    expect(calls).toEqual(['fill:sales@example.com']);
  });
});
