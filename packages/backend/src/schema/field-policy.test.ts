import { describe, expect, it } from 'vitest';
import {
  AttributeValidationError,
  canonicalizeFieldValues,
  compareDecimal,
  decimal,
  fieldDataTypes,
  normalizeDefaultValue,
  normalizeLocalizedText,
  normalizeUnit,
  normalizeValidationRules,
  parseCalendarDate,
  parseInstant,
  projectFieldValues,
  SchemaPolicyError,
  validateCanonicalValues,
  validateDataType,
  validateRepeatable,
  validateScope,
  validateVisibility,
  valueSlotsFor,
  type CanonicalFieldValue,
  type FieldDataType,
  type FieldValueShape,
} from './field-policy.js';

function shape(overrides: Partial<FieldValueShape> = {}): FieldValueShape {
  return {
    key: 'serial_number',
    dataType: 'text',
    repeatable: false,
    required: false,
    validation: {},
    ...overrides,
  };
}

function issueCodes(error: unknown): string[] {
  return error instanceof AttributeValidationError ? error.issues.map((issue) => issue.code) : [];
}

function canonicalize(field: FieldValueShape, raw: unknown): CanonicalFieldValue[] | string[] {
  try {
    return canonicalizeFieldValues(field, raw);
  } catch (error) {
    return issueCodes(error);
  }
}

describe('CAT-02 approved data types', () => {
  it('represents every approved data type with exactly one typed slot group', () => {
    expect(fieldDataTypes).toEqual([
      'text',
      'long_text',
      'number',
      'boolean',
      'date',
      'datetime',
      'select',
      'multiselect',
      'url',
      'email',
      'money',
      'reference',
    ]);
    for (const dataType of fieldDataTypes) {
      expect(valueSlotsFor(dataType).length).toBeGreaterThan(0);
      expect(validateDataType(dataType)).toBe(dataType);
    }
    expect(valueSlotsFor('reference')).toEqual(['referenceItem', 'referenceNode']);
  });

  it('rejects unapproved data types, scopes and visibility values', () => {
    for (const invalid of ['integer', 'decimal', 'json', '']) {
      expect(() => validateDataType(invalid)).toThrow(SchemaPolicyError);
    }
    expect(() => validateScope('node')).toThrow(SchemaPolicyError);
    expect(() => validateVisibility('unlisted')).toThrow(SchemaPolicyError);
    expect(validateScope('storage_node')).toBe('storage_node');
    expect(validateVisibility('private')).toBe('private');
  });

  it('rejects repeatable select and multiselect definitions', () => {
    for (const dataType of ['select', 'multiselect'] as FieldDataType[]) {
      expect(() => validateRepeatable(dataType, true)).toThrow(SchemaPolicyError);
      expect(validateRepeatable(dataType, false)).toBe(false);
    }
    expect(validateRepeatable('text', true)).toBe(true);
  });
});

describe('CAT-02 validation rules', () => {
  it('accepts only the rules approved for each data type', () => {
    expect(
      normalizeValidationRules('text', { minLength: 2, maxLength: 5, pattern: '^[A-Z]+$' }),
    ).toEqual({ minLength: 2, maxLength: 5, pattern: '^[A-Z]+$' });
    expect(normalizeValidationRules('number', { min: 0, max: '100000', integer: true })).toEqual({
      min: '0',
      max: '100000',
      integer: true,
    });
    expect(normalizeValidationRules('money', { currencies: ['UAH', 'EUR'] })).toEqual({
      currencies: ['UAH', 'EUR'],
    });
    expect(normalizeValidationRules('multiselect', { minSelected: 1, maxSelected: 2 })).toEqual({
      minSelected: 1,
      maxSelected: 2,
    });
    expect(normalizeValidationRules('reference', { referenceScope: 'item' })).toEqual({
      referenceScope: 'item',
    });
    expect(normalizeValidationRules('boolean', {})).toEqual({});
  });

  it('rejects unknown, malformed and contradictory rules', () => {
    for (const [dataType, rules] of [
      ['text', { min: 1 }],
      ['text', { minLength: -1 }],
      ['text', { minLength: 5, maxLength: 2 }],
      ['text', { pattern: '([' }],
      ['number', { minLength: 2 }],
      ['number', { min: 'abc' }],
      ['number', { min: 5, max: 1 }],
      ['number', { min: '1.00000000001' }],
      ['money', { currencies: [] }],
      ['money', { currencies: ['uah'] }],
      ['money', { currencies: ['UAH', 'UAH'] }],
      ['money', { min: '1.00001' }],
      ['date', { min: '2026-02-31' }],
      ['datetime', { min: '2026-09-09' }],
      ['multiselect', { minSelected: 3, maxSelected: 1 }],
      ['reference', { referenceScope: 'node' }],
      ['boolean', { integer: true }],
    ] as [FieldDataType, unknown][]) {
      expect(() => normalizeValidationRules(dataType, rules), `${dataType}`).toThrow(
        SchemaPolicyError,
      );
    }
    expect(() => normalizeValidationRules('text', [])).toThrow(SchemaPolicyError);
  });

  it('drops null rules and keeps stored rules stable', () => {
    expect(normalizeValidationRules('text', { minLength: null, maxLength: 10 })).toEqual({
      maxLength: 10,
    });
    expect(normalizeValidationRules('text', null)).toEqual({});
  });
});

describe('CAT-02 canonical value serializer', () => {
  it('canonicalizes each data type into its typed slot', () => {
    expect(canonicalize(shape(), '  SN 000   DEMO ')).toEqual([
      { slot: 'text', text: 'SN 000 DEMO' },
    ]);
    expect(canonicalize(shape({ dataType: 'long_text' }), ' line\n  line ')).toEqual([
      { slot: 'text', text: 'line\n  line' },
    ]);
    expect(canonicalize(shape({ dataType: 'number' }), '012.5000')).toEqual([
      { slot: 'number', number: '12.5' },
    ]);
    expect(canonicalize(shape({ dataType: 'number' }), 3)).toEqual([
      { slot: 'number', number: '3' },
    ]);
    expect(canonicalize(shape({ dataType: 'boolean' }), false)).toEqual([
      { slot: 'boolean', boolean: false },
    ]);
    expect(canonicalize(shape({ dataType: 'date' }), '2026-09-09')).toEqual([
      { slot: 'date', date: '2026-09-09' },
    ]);
    expect(canonicalize(shape({ dataType: 'datetime' }), '2026-09-09T13:00:00+03:00')).toEqual([
      { slot: 'datetime', datetime: '2026-09-09T10:00:00.000Z' },
    ]);
    expect(
      canonicalize(shape({ dataType: 'money' }), { amount: '10.50', currency: 'UAH' }),
    ).toEqual([{ slot: 'money', amount: '10.5', currency: 'UAH' }]);
    expect(canonicalize(shape({ dataType: 'url' }), 'https://example.test/a')).toEqual([
      { slot: 'text', text: 'https://example.test/a' },
    ]);
    expect(
      canonicalize(shape({ dataType: 'reference' }), {
        scope: 'storage_node',
        id: '11111111-1111-4111-8111-111111111111',
      }),
    ).toEqual([{ slot: 'referenceNode', nodeId: '11111111-1111-4111-8111-111111111111' }]);
  });

  it('reports stable field keys and issue codes for malformed values', () => {
    expect(canonicalize(shape({ dataType: 'number' }), 'abc')).toEqual(['INVALID_NUMBER']);
    expect(canonicalize(shape({ dataType: 'number' }), true)).toEqual(['TYPE_MISMATCH']);
    expect(canonicalize(shape({ dataType: 'number' }), '1.00000000001')).toEqual([
      'INVALID_NUMBER',
    ]);
    expect(canonicalize(shape({ dataType: 'date' }), '2026-02-31')).toEqual(['INVALID_DATE']);
    expect(canonicalize(shape({ dataType: 'datetime' }), '2026-09-09')).toEqual([
      'INVALID_DATETIME',
    ]);
    expect(canonicalize(shape({ dataType: 'money' }), { amount: '1', currency: 'uah' })).toEqual([
      'INVALID_CURRENCY',
    ]);
    expect(canonicalize(shape({ dataType: 'reference' }), { scope: 'item', id: 'x' })).toEqual([
      'INVALID_REFERENCE',
    ]);
    expect(canonicalize(shape({ dataType: 'select' }), 'new')).toEqual(['UNKNOWN_OPTION']);
    try {
      canonicalizeFieldValues(shape({ key: 'quantity', dataType: 'number' }), 'abc');
      expect.unreachable();
    } catch (error) {
      expect((error as AttributeValidationError).issues).toEqual([
        { fieldKey: 'quantity', code: 'INVALID_NUMBER' },
      ]);
    }
  });

  it('accepts arrays only for repeatable and multiselect fields', () => {
    expect(canonicalize(shape({ repeatable: true }), ['a', 'b'])).toEqual([
      { slot: 'text', text: 'a' },
      { slot: 'text', text: 'b' },
    ]);
    expect(canonicalize(shape(), ['a'])).toEqual(['NOT_REPEATABLE']);
    expect(canonicalize(shape({ dataType: 'multiselect' }), [])).toEqual([]);
    expect(canonicalize(shape({ repeatable: true }), ['a', null])).toEqual(['TYPE_MISMATCH']);
  });

  it('projects multiselect and repeatable values back as ordered arrays', () => {
    const multiselect = shape({ key: 'materials', dataType: 'multiselect' });
    const values: CanonicalFieldValue[] = [
      { slot: 'option', optionId: '11111111-1111-4111-8111-111111111111' },
      { slot: 'option', optionId: '22222222-2222-4222-8222-222222222222' },
    ];
    expect(projectFieldValues(multiselect, values)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(projectFieldValues(shape(), [])).toBeNull();
    expect(
      projectFieldValues(shape({ dataType: 'money' }), [
        { slot: 'money', amount: '10.5', currency: 'UAH' },
      ]),
    ).toEqual({ amount: '10.5', currency: 'UAH' });
    expect(
      projectFieldValues(shape({ dataType: 'reference' }), [
        { slot: 'referenceItem', itemId: '11111111-1111-4111-8111-111111111111' },
      ]),
    ).toEqual({ scope: 'item', id: '11111111-1111-4111-8111-111111111111' });
  });
});

describe('CAT-02 value rule enforcement', () => {
  it('enforces required, length, pattern, format and range rules', () => {
    expect(validateCanonicalValues(shape({ required: true }), [])).toEqual([
      { fieldKey: 'serial_number', code: 'REQUIRED' },
    ]);
    expect(validateCanonicalValues(shape(), [])).toEqual([]);
    const bounded = shape({ validation: { minLength: 3, maxLength: 5, pattern: '^[A-Z]+$' } });
    expect(
      validateCanonicalValues(bounded, [{ slot: 'text', text: 'ab' }]).map((issue) => issue.code),
    ).toEqual(['TOO_SHORT', 'PATTERN_MISMATCH']);
    expect(
      validateCanonicalValues(bounded, [{ slot: 'text', text: 'ABCDEF' }]).map(
        (issue) => issue.code,
      ),
    ).toEqual(['TOO_LONG']);
    expect(
      validateCanonicalValues(shape({ dataType: 'url' }), [
        { slot: 'text', text: 'ftp://example.test' },
      ]).map((issue) => issue.code),
    ).toEqual(['INVALID_URL']);
    expect(
      validateCanonicalValues(shape({ dataType: 'email' }), [
        { slot: 'text', text: 'not-an-email' },
      ]).map((issue) => issue.code),
    ).toEqual(['INVALID_EMAIL']);
    const quantity = shape({
      dataType: 'number',
      validation: { min: '0', max: '100000', integer: true },
    });
    expect(
      validateCanonicalValues(quantity, [{ slot: 'number', number: '-1.5' }]).map(
        (issue) => issue.code,
      ),
    ).toEqual(['NOT_INTEGER', 'OUT_OF_RANGE']);
    expect(validateCanonicalValues(quantity, [{ slot: 'number', number: '17' }])).toEqual([]);
    expect(
      validateCanonicalValues(shape({ dataType: 'money', validation: { currencies: ['UAH'] } }), [
        { slot: 'money', amount: '1', currency: 'EUR' },
      ]).map((issue) => issue.code),
    ).toEqual(['INVALID_CURRENCY']);
    expect(
      validateCanonicalValues(shape({ dataType: 'date', validation: { min: '2026-01-01' } }), [
        { slot: 'date', date: '2025-12-31' },
      ]).map((issue) => issue.code),
    ).toEqual(['OUT_OF_RANGE']);
  });

  it('enforces multiselect cardinality, duplicate options and slot agreement', () => {
    const materials = shape({
      key: 'materials',
      dataType: 'multiselect',
      validation: { minSelected: 2, maxSelected: 2 },
    });
    const option = (id: string): CanonicalFieldValue => ({ slot: 'option', optionId: id });
    const metal = option('11111111-1111-4111-8111-111111111111');
    expect(validateCanonicalValues(materials, [metal, metal]).map((issue) => issue.code)).toEqual([
      'DUPLICATE_OPTION',
    ]);
    expect(validateCanonicalValues(materials, [metal]).map((issue) => issue.code)).toEqual([
      'TOO_FEW_SELECTED',
    ]);
    expect(
      validateCanonicalValues(shape({ dataType: 'select' }), [metal, metal]).map(
        (issue) => issue.code,
      ),
    ).toEqual(['NOT_REPEATABLE']);
    expect(
      validateCanonicalValues(shape({ dataType: 'number' }), [{ slot: 'text', text: 'x' }]).map(
        (issue) => issue.code,
      ),
    ).toEqual(['TYPE_MISMATCH']);
    expect(
      validateCanonicalValues(
        shape({ dataType: 'reference', validation: { referenceScope: 'item' } }),
        [{ slot: 'referenceNode', nodeId: '11111111-1111-4111-8111-111111111111' }],
      ).map((issue) => issue.code),
    ).toEqual(['INVALID_REFERENCE']);
  });
});

describe('CAT-02 definition metadata policy', () => {
  it('requires English labels, optional Ukrainian labels and no other locale', () => {
    expect(normalizeLocalizedText({ en: ' Serial ', uk: ' Серійний ' })).toEqual({
      en: 'Serial',
      uk: 'Серійний',
    });
    for (const invalid of [
      { uk: 'Серійний' },
      { en: ' ' },
      { en: 'Serial', uk: '' },
      { en: 'Serial', de: 'Serie' },
      'Serial',
    ])
      expect(() => normalizeLocalizedText(invalid)).toThrow(SchemaPolicyError);
  });

  it('normalizes units and rejects blank or oversized units', () => {
    expect(normalizeUnit(' kg ')).toBe('kg');
    expect(normalizeUnit(null)).toBeNull();
    expect(() => normalizeUnit(' ')).toThrow(SchemaPolicyError);
    expect(() => normalizeUnit('x'.repeat(33))).toThrow(SchemaPolicyError);
  });

  it('validates definition defaults with the same engine as stored values', () => {
    expect(normalizeDefaultValue(shape({ dataType: 'number' }), '3')).toEqual([
      { slot: 'number', number: '3' },
    ]);
    expect(normalizeDefaultValue(shape({ required: true }), null)).toBeNull();
    expect(() =>
      normalizeDefaultValue(shape({ dataType: 'number', validation: { max: '10' } }), '11'),
    ).toThrow(SchemaPolicyError);
    expect(() => normalizeDefaultValue(shape({ dataType: 'date' }), 'today')).toThrow(
      SchemaPolicyError,
    );
  });
});

describe('CAT-02 decimal and instant helpers', () => {
  it('compares decimals beyond the safe float range exactly', () => {
    expect(compareDecimal('9007199254740993', '9007199254740992')).toBe(1);
    expect(compareDecimal('-1.5', '-1.50')).toBe(0);
    expect(compareDecimal('-2', '1')).toBe(-1);
    expect(compareDecimal('0', '-0')).toBe(0);
    expect(compareDecimal('1.0000000001', '1.0000000002')).toBe(-1);
  });

  it('normalizes decimals and rejects non-decimal input', () => {
    expect(decimal(' 0012.3400 ')).toBe('12.34');
    expect(decimal('-0.0')).toBe('0');
    expect(decimal('1e3')).toBeNull();
    expect(decimal(Number.NaN)).toBeNull();
    expect(decimal('')).toBeNull();
  });

  it('accepts only real calendar dates and ISO instants', () => {
    expect(parseCalendarDate('2026-09-09')).toBe('2026-09-09');
    expect(parseCalendarDate('2026-13-01')).toBeNull();
    expect(parseInstant('2026-09-09T10:00:00Z')).toBe('2026-09-09T10:00:00.000Z');
    expect(parseInstant('2026-09-09T10:00')).toBeNull();
  });
});
