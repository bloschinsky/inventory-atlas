import type { CatalogDictionaryService } from '@inventory-atlas/backend';

export const CATALOG_RUNTIME = Symbol('CATALOG_RUNTIME');

export interface CatalogRuntimePort {
  catalogDictionaries(): Pick<
    CatalogDictionaryService,
    | 'listCategories'
    | 'createCategory'
    | 'updateCategory'
    | 'archiveCategory'
    | 'listLifecycleStatuses'
    | 'createLifecycleStatus'
    | 'updateLifecycleStatus'
    | 'archiveLifecycleStatus'
  >;
}
