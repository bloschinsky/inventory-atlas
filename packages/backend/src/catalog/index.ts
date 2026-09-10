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
} from './item-repository.js';
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
