export {
  CatalogDictionaryRepository,
  type CategoryRecord,
  type LifecycleStatusRecord,
} from './dictionary-repository.js';
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
