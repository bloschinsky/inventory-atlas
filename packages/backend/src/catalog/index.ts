export {
  ItemRepository,
  itemSlug,
  itemVisibilities,
  normalizeItemVisibility,
  normalizeTagName,
  type CreateItemCoreInput,
  type ItemCoreRecord,
  type ItemTransaction,
  type ItemVisibility,
  ItemPolicyError,
  type ItemPolicyCode,
} from './item-repository.js';
export {
  ItemCreateError,
  ItemService,
  type CreatedItem,
  type CreateItemInput,
  type CreateItemOutcome,
  type ItemCreateErrorCode,
  type ItemMutationMetadata,
} from './item-service.js';
export {
  CatalogDictionaryRepository,
  type CategoryRecord,
  type DictionaryMutationMetadata,
  type LifecycleStatusRecord,
} from './dictionary-repository.js';
export {
  CatalogDictionaryAuthorizationError,
  CatalogDictionaryService,
  type DictionaryRequestMetadata,
} from './dictionary-service.js';
export {
  DictionaryPolicyError,
  normalizeDisplayTemplate,
  normalizeLabels,
  rejectKeyMutation,
  semanticColorTokenPattern,
  stableDictionaryKeyPattern,
  validateColorToken,
  validateDisplayOrder,
  validateExpectedVersion,
  validateStableKey,
  type DictionaryPolicyCode,
  type LocalizedLabel,
} from './dictionary-policy.js';
