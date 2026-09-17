import { describe, it, expect } from 'vitest';
import { IllegalTransitionError } from '../../src/state/errors.js';
import { IllegalJobTransitionError } from '../../src/state/jobStateMachine.js';
import { IllegalAuthTransitionError } from '../../src/state/authStateMachine.js';

describe('IllegalTransitionError', () => {
  it('is a base class for IllegalJobTransitionError', () => {
    const err = new IllegalJobTransitionError('SCHEDULED', 'COMPLETE');
    expect(err).toBeInstanceOf(IllegalTransitionError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('IllegalJobTransitionError');
  });

  it('is a base class for IllegalAuthTransitionError', () => {
    const err = new IllegalAuthTransitionError('NOT_STARTED', 'AUTHENTICATED');
    expect(err).toBeInstanceOf(IllegalTransitionError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('IllegalAuthTransitionError');
  });
});
