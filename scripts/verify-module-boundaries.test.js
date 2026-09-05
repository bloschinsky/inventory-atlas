import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { violationsForSource } from './verify-module-boundaries.mjs';

describe('module boundary verifier', () => {
  it('accepts a facade import', async () => {
    const source = await readFile(
      new URL('./fixtures/module-boundaries/positive/facade-import.js', import.meta.url),
      'utf8',
    );
    expect(violationsForSource('apps/web/src/features/items/view.js', source)).toEqual([]);
  });

  it('rejects a direct PrimeVue import', async () => {
    const source = await readFile(
      new URL('./fixtures/module-boundaries/negative/primevue-import.js', import.meta.url),
      'utf8',
    );
    expect(violationsForSource('apps/web/src/features/items/view.js', source)).toHaveLength(1);
  });

  it('rejects a server response cache in Pinia', async () => {
    const source = await readFile(
      new URL('./fixtures/module-boundaries/negative/pinia-server-cache.js', import.meta.url),
      'utf8',
    );
    expect(violationsForSource('apps/web/src/app/stores/items.js', source)).toHaveLength(1);
  });
});
