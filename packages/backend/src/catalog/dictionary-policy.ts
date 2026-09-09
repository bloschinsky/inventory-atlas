export const stableDictionaryKeyPattern = /^[a-z][a-z0-9_]{0,63}$/u;
export const semanticColorTokenPattern = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/u;

export type DictionaryPolicyCode =
  | 'CATALOG_DICTIONARY_INVALID_KEY'
  | 'CATALOG_DICTIONARY_ENGLISH_LABEL_REQUIRED'
  | 'CATALOG_DICTIONARY_UKRAINIAN_LABEL_INVALID'
  | 'CATALOG_DICTIONARY_INVALID_ORDER'
  | 'CATALOG_DICTIONARY_INVALID_COLOR_TOKEN'
  | 'CATALOG_DICTIONARY_INVALID_DISPLAY_TEMPLATE'
  | 'CATALOG_DICTIONARY_KEY_IMMUTABLE'
  | 'CATALOG_DICTIONARY_INVALID_VERSION'
  | 'CATALOG_DICTIONARY_NOT_FOUND'
  | 'CATALOG_DICTIONARY_VERSION_CONFLICT'
  | 'CATALOG_CATEGORY_PARENT_INVALID';

export class DictionaryPolicyError extends Error {
  constructor(
    readonly code: DictionaryPolicyCode,
    message: string,
  ) {
    super(message);
    this.name = 'DictionaryPolicyError';
  }
}

export interface LocalizedLabel {
  en: string;
  uk?: string;
}

export function validateStableKey(value: unknown): string {
  if (typeof value !== 'string' || !stableDictionaryKeyPattern.test(value)) {
    throw new DictionaryPolicyError(
      'CATALOG_DICTIONARY_INVALID_KEY',
      'Dictionary keys must be lower-case stable identifiers.',
    );
  }
  return value;
}

export function normalizeLabels(value: unknown): LocalizedLabel {
  if (!isRecord(value) || typeof value.en !== 'string' || value.en.trim() === '') {
    throw new DictionaryPolicyError(
      'CATALOG_DICTIONARY_ENGLISH_LABEL_REQUIRED',
      'An English dictionary label is required.',
    );
  }
  if (value.uk !== undefined && (typeof value.uk !== 'string' || value.uk.trim() === '')) {
    throw new DictionaryPolicyError(
      'CATALOG_DICTIONARY_UKRAINIAN_LABEL_INVALID',
      'The Ukrainian dictionary label must be non-empty when supplied.',
    );
  }
  const labels: LocalizedLabel = { en: value.en.trim() };
  if (typeof value.uk === 'string') labels.uk = value.uk.trim();
  return labels;
}

export function validateDisplayOrder(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DictionaryPolicyError(
      'CATALOG_DICTIONARY_INVALID_ORDER',
      'Dictionary display order must be a non-negative integer.',
    );
  }
  return value as number;
}

export function validateColorToken(value: unknown): string {
  if (typeof value !== 'string' || !semanticColorTokenPattern.test(value)) {
    throw new DictionaryPolicyError(
      'CATALOG_DICTIONARY_INVALID_COLOR_TOKEN',
      'Lifecycle status color must be a semantic token.',
    );
  }
  return value;
}

export function normalizeDisplayTemplate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DictionaryPolicyError(
      'CATALOG_DICTIONARY_INVALID_DISPLAY_TEMPLATE',
      'A category display template must be non-empty when supplied.',
    );
  }
  return value.trim();
}

export function validateExpectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new DictionaryPolicyError(
      'CATALOG_DICTIONARY_INVALID_VERSION',
      'Expected version must be a positive integer.',
    );
  }
  return value as number;
}

export function rejectKeyMutation(input: object): void {
  if ('key' in input) {
    throw new DictionaryPolicyError(
      'CATALOG_DICTIONARY_KEY_IMMUTABLE',
      'Dictionary stable keys cannot be changed.',
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
