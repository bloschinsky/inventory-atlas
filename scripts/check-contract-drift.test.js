import { describe, expect, it } from 'vitest';
import { driftedPaths } from './check-contract-drift.mjs';

describe('contract drift detection', () => {
  it('reports changed, missing, and unexpected generated files', () => {
    const before = new Map([
      ['changed.ts', 'old'],
      ['missing.ts', 'committed'],
    ]);
    const after = new Map([
      ['changed.ts', 'new'],
      ['unexpected.ts', 'generated'],
    ]);
    expect(driftedPaths(before, after)).toEqual(['changed.ts', 'missing.ts', 'unexpected.ts']);
  });
});
