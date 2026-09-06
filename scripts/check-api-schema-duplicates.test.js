import { describe, expect, it } from 'vitest';
import { duplicatePayloadViolations } from './check-api-schema-duplicates.mjs';

describe('generated API schema policy', () => {
  it('rejects a handwritten payload declaration', () => {
    expect(
      duplicatePayloadViolations(
        'apps/web/src/features/items/save.js',
        'type SaveItemRequest = { name: string };',
      ),
    ).toHaveLength(1);
  });

  it('allows generated contract imports and local non-payload view models', () => {
    const source =
      "import type { ItemMutationRequestDto } from '@inventory-atlas/contracts';\ntype ItemCard = { title: string };";
    expect(duplicatePayloadViolations('apps/web/src/features/items/save.js', source)).toEqual([]);
  });
});
