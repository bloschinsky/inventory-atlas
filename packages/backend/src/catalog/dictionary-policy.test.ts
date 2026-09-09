import { describe, expect, it } from 'vitest';
import {
  normalizeDisplayTemplate,
  normalizeLabels,
  rejectKeyMutation,
  validateColorToken,
  validateDisplayOrder,
  validateExpectedVersion,
  validateStableKey,
} from './dictionary-policy.js';

describe('catalog dictionary policy', () => {
  it('accepts stable keys and bilingual labels without changing their identity', () => {
    expect(validateStableKey('for_sale')).toBe('for_sale');
    expect(normalizeLabels({ en: '  Tools ', uk: ' Інструменти ' })).toEqual({
      en: 'Tools',
      uk: 'Інструменти',
    });
    expect(() => rejectKeyMutation({ labels: { en: 'Renamed' } })).not.toThrow();
    expect(() => rejectKeyMutation({ key: 'renamed' })).toThrowError(
      expect.objectContaining({ code: 'CATALOG_DICTIONARY_KEY_IMMUTABLE' }),
    );
  });

  it.each(['', 'Upper_case', '_leading', 'with-dash', 'a'.repeat(65)])(
    'rejects invalid stable key %j',
    (key) => {
      expect(() => validateStableKey(key)).toThrowError(
        expect.objectContaining({ code: 'CATALOG_DICTIONARY_INVALID_KEY' }),
      );
    },
  );

  it('requires English and permits optional non-empty Ukrainian', () => {
    expect(normalizeLabels({ en: 'Books' })).toEqual({ en: 'Books' });
    expect(() => normalizeLabels({ uk: 'Книги' })).toThrowError(
      expect.objectContaining({ code: 'CATALOG_DICTIONARY_ENGLISH_LABEL_REQUIRED' }),
    );
    expect(() => normalizeLabels({ en: 'Books', uk: ' ' })).toThrowError(
      expect.objectContaining({ code: 'CATALOG_DICTIONARY_UKRAINIAN_LABEL_INVALID' }),
    );
  });

  it('validates ordering, versions, templates and semantic colors', () => {
    expect(validateDisplayOrder(0)).toBe(0);
    expect(validateExpectedVersion(1)).toBe(1);
    expect(normalizeDisplayTemplate(' {{category}} ')).toBe('{{category}}');
    expect(validateColorToken('status.warning')).toBe('status.warning');
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => validateDisplayOrder(value)).toThrow();
    }
    expect(() => validateExpectedVersion(0)).toThrow();
    expect(() => normalizeDisplayTemplate(' ')).toThrow();
    expect(() => validateColorToken('red; color: red')).toThrow();
  });
});
