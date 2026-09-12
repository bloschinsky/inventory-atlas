import type { StorageService } from '@inventory-atlas/backend';

export const STORAGE_RUNTIME = Symbol('STORAGE_RUNTIME');

export interface StorageRuntimePort {
  storage(): Pick<StorageService, 'create' | 'get' | 'list' | 'move' | 'update'>;
}
