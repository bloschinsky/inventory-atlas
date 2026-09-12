import type { ItemService } from '@inventory-atlas/backend';

export const ITEMS_RUNTIME = Symbol('ITEMS_RUNTIME');

export interface ItemsRuntimePort {
  catalogItems(): Pick<ItemService, 'create' | 'get' | 'move' | 'movements' | 'update'>;
}
