import { describe, expect, it } from 'vitest';
import { foundationStatus } from './index.js';

describe('backend public surface', () => {
  it('exposes the foundation status', () => {
    expect(foundationStatus()).toEqual({ status: 'ready' });
  });
});
