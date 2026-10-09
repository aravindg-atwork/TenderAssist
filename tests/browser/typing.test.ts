import { describe, expect, it } from 'vitest';
import type { Locator } from 'playwright-core';
import { typeAllAtOnce, typeLikeAPerson } from '../../src/browser/portalLoginController.js';

function fakeField() {
  const calls: string[] = [];
  const field = {
    fill: async (text: string) => { calls.push(`fill:${text}`); },
    focus: async () => { calls.push('focus'); },
    pressSequentially: async (text: string) => { calls.push(`key:${text}`); },
  } as unknown as Locator;
  return { field, calls };
}

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
