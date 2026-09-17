import { describe, it, expect } from 'vitest';

describe('toolchain smoke test', () => {
  it('runs TypeScript tests via vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
