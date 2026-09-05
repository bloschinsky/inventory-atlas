import { describe, expect, it } from 'vitest';
import { syntheticPublicId } from './index.js';

describe('testkit', () => {
  it('creates synthetic identifiers', () => {
    expect(syntheticPublicId(7)).toBe('fixture-7');
  });
});
