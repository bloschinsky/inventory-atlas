export {
  CatalogDictionaryRepository,
  type CategoryRecord,
  type LifecycleStatusRecord,
} from './dictionary-repository.js';
export {
  CatalogDictionaryAuthorizationError,
  CatalogDictionaryService,
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
