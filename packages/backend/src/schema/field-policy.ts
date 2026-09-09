/**
 * Schema module domain policy: the approved data types, the closed validation-rule set for
 * each of them, and the canonical value serializer that every persistence path shares.
 */

export const fieldScopes = ['item', 'storage_node'] as const;
export type FieldScope = (typeof fieldScopes)[number];

export const fieldDataTypes = [
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
] as const;
export type FieldDataType = (typeof fieldDataTypes)[number];

export const fieldVisibilities = ['public', 'authenticated', 'private'] as const;
export type FieldVisibility = (typeof fieldVisibilities)[number];

export const stableFieldKeyPattern = /^[a-z][a-z0-9_]{0,63}$/u;
export const currencyPattern = /^[A-Z]{3}$/u;

/** Typed `attribute_values` slots. `reference` accepts exactly one of its two slots. */
export const fieldValueSlots = [
  'text',
  'number',
  'boolean',
  'date',
  'datetime',
  'option',
  'money',
  'referenceItem',
  'referenceNode',
] as const;
export type FieldValueSlot = (typeof fieldValueSlots)[number];

const slotsByDataType: Readonly<Record<FieldDataType, readonly FieldValueSlot[]>> = {
  text: ['text'],
  long_text: ['text'],
  url: ['text'],
  email: ['text'],
  number: ['number'],
  boolean: ['boolean'],
  date: ['date'],
  datetime: ['datetime'],
  select: ['option'],
  multiselect: ['option'],
  money: ['money'],
  reference: ['referenceItem', 'referenceNode'],
};

export function valueSlotsFor(dataType: FieldDataType): readonly FieldValueSlot[] {
  return slotsByDataType[dataType];
}

/** `select` and `multiselect` own their options; every other type has none. */
export function usesOptions(dataType: FieldDataType): boolean {
  return dataType === 'select' || dataType === 'multiselect';
}

export type CanonicalFieldValue =
  | { slot: 'text'; text: string }
  | { slot: 'number'; number: string }
  | { slot: 'boolean'; boolean: boolean }
  | { slot: 'date'; date: string }
  | { slot: 'datetime'; datetime: string }
  | { slot: 'option'; optionId: string }
  | { slot: 'money'; amount: string; currency: string }
  | { slot: 'referenceItem'; itemId: string }
  | { slot: 'referenceNode'; nodeId: string };

export interface ValidationRules {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: string;
  max?: string;
  integer?: boolean;
  currencies?: readonly string[];
  minSelected?: number;
  maxSelected?: number;
  referenceScope?: FieldScope | 'any';
}

const ruleNamesByDataType: Readonly<Record<FieldDataType, readonly (keyof ValidationRules)[]>> = {
  text: ['minLength', 'maxLength', 'pattern'],
  long_text: ['minLength', 'maxLength', 'pattern'],
  url: ['minLength', 'maxLength', 'pattern'],
  email: ['minLength', 'maxLength', 'pattern'],
  number: ['min', 'max', 'integer'],
  boolean: [],
  date: ['min', 'max'],
  datetime: ['min', 'max'],
  select: [],
  multiselect: ['minSelected', 'maxSelected'],
  money: ['min', 'max', 'currencies'],
  reference: ['referenceScope'],
};

export function validationRuleNamesFor(
  dataType: FieldDataType,
): readonly (keyof ValidationRules)[] {
  return ruleNamesByDataType[dataType];
}

export type SchemaPolicyCode =
  | 'SCHEMA_FIELD_INVALID_KEY'
  | 'SCHEMA_FIELD_INVALID_SCOPE'
  | 'SCHEMA_FIELD_INVALID_DATA_TYPE'
  | 'SCHEMA_FIELD_INVALID_VISIBILITY'
  | 'SCHEMA_FIELD_ENGLISH_LABEL_REQUIRED'
  | 'SCHEMA_FIELD_UKRAINIAN_LABEL_INVALID'
  | 'SCHEMA_FIELD_INVALID_UNIT'
  | 'SCHEMA_FIELD_INVALID_ORDER'
  | 'SCHEMA_FIELD_INVALID_VERSION'
  | 'SCHEMA_FIELD_REPEATABLE_NOT_ALLOWED'
  | 'SCHEMA_FIELD_INVALID_VALIDATION_RULE'
  | 'SCHEMA_FIELD_INVALID_DEFAULT'
  | 'SCHEMA_FIELD_IDENTITY_IMMUTABLE'
  | 'SCHEMA_FIELD_NOT_FOUND'
  | 'SCHEMA_FIELD_VERSION_CONFLICT'
  | 'SCHEMA_FIELD_CATEGORY_INVALID'
  | 'SCHEMA_FIELD_CONVERSION_REQUIRED'
  | 'SCHEMA_FIELD_CONVERSION_UNSUPPORTED'
  | 'SCHEMA_OPTION_NOT_FOUND'
  | 'SCHEMA_OPTION_NOT_SUPPORTED'
  | 'SCHEMA_OPTION_INVALID_KEY';

export class SchemaPolicyError extends Error {
  constructor(
    readonly code: SchemaPolicyCode,
    message: string,
  ) {
    super(message);
    this.name = 'SchemaPolicyError';
  }
}

export type AttributeIssueCode =
  | 'UNKNOWN_FIELD'
  | 'REQUIRED'
  | 'TYPE_MISMATCH'
  | 'NOT_REPEATABLE'
  | 'DUPLICATE_OPTION'
  | 'UNKNOWN_OPTION'
  | 'ARCHIVED_OPTION'
  | 'TOO_FEW_SELECTED'
  | 'TOO_MANY_SELECTED'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'PATTERN_MISMATCH'
  | 'OUT_OF_RANGE'
  | 'NOT_INTEGER'
  | 'INVALID_NUMBER'
  | 'INVALID_URL'
  | 'INVALID_EMAIL'
  | 'INVALID_DATE'
  | 'INVALID_DATETIME'
  | 'INVALID_CURRENCY'
  | 'INVALID_REFERENCE'
  | 'NON_CONTIGUOUS_POSITION';

export interface AttributeIssue {
  fieldKey: string;
  code: AttributeIssueCode;
}

/** Validation failures always report the stable field key, never a database identifier. */
export class AttributeValidationError extends Error {
  readonly code = 'SCHEMA_ATTRIBUTE_VALIDATION_FAILED';

  constructor(readonly issues: readonly AttributeIssue[]) {
    super(`Attribute validation failed for ${issues.map((issue) => issue.fieldKey).join(', ')}.`);
    this.name = 'AttributeValidationError';
  }
}

export interface LocalizedText {
  en: string;
  uk?: string;
}

export function validateFieldKey(value: unknown, code: SchemaPolicyCode): string {
  if (typeof value !== 'string' || !stableFieldKeyPattern.test(value)) {
    throw new SchemaPolicyError(code, 'Stable keys must be lower-case stable identifiers.');
  }
  return value;
}

export function normalizeLocalizedText(value: unknown): LocalizedText {
  if (!isRecord(value) || typeof value.en !== 'string' || value.en.trim() === '') {
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_ENGLISH_LABEL_REQUIRED',
      'An English label is required.',
    );
  }
  const extra = Object.keys(value).filter((key) => key !== 'en' && key !== 'uk');
  if (
    extra.length ||
    (value.uk !== undefined && (typeof value.uk !== 'string' || !value.uk.trim()))
  )
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_UKRAINIAN_LABEL_INVALID',
      'Localized text accepts a non-empty English label and an optional non-empty Ukrainian label.',
    );
  const text: LocalizedText = { en: value.en.trim() };
  if (typeof value.uk === 'string') text.uk = value.uk.trim();
  return text;
}

export function normalizeOptionalLocalizedText(value: unknown): LocalizedText | null {
  return value === null || value === undefined ? null : normalizeLocalizedText(value);
}

export function validateScope(value: unknown): FieldScope {
  if (!fieldScopes.includes(value as FieldScope))
    throw new SchemaPolicyError('SCHEMA_FIELD_INVALID_SCOPE', 'Field scope is not approved.');
  return value as FieldScope;
}

export function validateDataType(value: unknown): FieldDataType {
  if (!fieldDataTypes.includes(value as FieldDataType))
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_INVALID_DATA_TYPE',
      'Field data type is not approved.',
    );
  return value as FieldDataType;
}

export function validateVisibility(value: unknown): FieldVisibility {
  if (!fieldVisibilities.includes(value as FieldVisibility))
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_INVALID_VISIBILITY',
      'Field visibility is not approved.',
    );
  return value as FieldVisibility;
}

export function normalizeUnit(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 32)
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_INVALID_UNIT',
      'A unit must be non-empty and at most 32 characters.',
    );
  return value.trim();
}

export function validateDisplayOrder(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_INVALID_ORDER',
      'Display order must be a non-negative integer.',
    );
  return value as number;
}

export function validateExpectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_INVALID_VERSION',
      'Expected version must be a positive integer.',
    );
  return value as number;
}

export function validateRepeatable(dataType: FieldDataType, repeatable: unknown): boolean {
  if (typeof repeatable !== 'boolean')
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_REPEATABLE_NOT_ALLOWED',
      'Repeatable must be a boolean.',
    );
  if (repeatable && usesOptions(dataType))
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_REPEATABLE_NOT_ALLOWED',
      'repeatable = true is invalid for select and multiselect; use multiselect for several options.',
    );
  return repeatable;
}

/** Rejects unknown rule names so a typo cannot silently disable validation. */
export function normalizeValidationRules(dataType: FieldDataType, value: unknown): ValidationRules {
  if (value === null || value === undefined) return {};
  if (!isRecord(value)) throw invalidRule('Validation rules must be an object.');
  const allowed = new Set<string>(validationRuleNamesFor(dataType));
  const rules: Record<string, unknown> = {};
  for (const [name, rule] of Object.entries(value)) {
    if (rule === null || rule === undefined) continue;
    if (!allowed.has(name)) throw invalidRule(`Rule ${name} is not supported for ${dataType}.`);
    rules[name] = normalizeRule(name as keyof ValidationRules, rule, dataType);
  }
  const bounded = rules as ValidationRules;
  if (
    bounded.minLength !== undefined &&
    bounded.maxLength !== undefined &&
    bounded.minLength > bounded.maxLength
  )
    throw invalidRule('minLength cannot exceed maxLength.');
  if (
    bounded.minSelected !== undefined &&
    bounded.maxSelected !== undefined &&
    bounded.minSelected > bounded.maxSelected
  )
    throw invalidRule('minSelected cannot exceed maxSelected.');
  if (bounded.min !== undefined && bounded.max !== undefined && compare(dataType, bounded) > 0)
    throw invalidRule('min cannot exceed max.');
  return bounded;
}

function compare(dataType: FieldDataType, rules: ValidationRules): number {
  return dataType === 'date' || dataType === 'datetime'
    ? rules.min!.localeCompare(rules.max!)
    : compareDecimal(rules.min!, rules.max!);
}

function normalizeRule(
  name: keyof ValidationRules,
  rule: unknown,
  dataType: FieldDataType,
): unknown {
  switch (name) {
    case 'minLength':
    case 'maxLength':
    case 'minSelected':
    case 'maxSelected':
      if (!Number.isSafeInteger(rule) || (rule as number) < 0)
        throw invalidRule(`${name} must be a non-negative integer.`);
      return rule;
    case 'integer':
      if (typeof rule !== 'boolean') throw invalidRule('integer must be a boolean.');
      return rule;
    case 'pattern':
      if (typeof rule !== 'string' || !rule || rule.length > 200)
        throw invalidRule('pattern must be a non-empty expression of at most 200 characters.');
      try {
        new RegExp(rule, 'u');
      } catch {
        throw invalidRule('pattern must be a valid Unicode regular expression.');
      }
      return rule;
    case 'currencies': {
      if (!Array.isArray(rule) || !rule.length)
        throw invalidRule('currencies must be a non-empty array.');
      const currencies = rule.map((entry) => {
        if (typeof entry !== 'string' || !currencyPattern.test(entry))
          throw invalidRule('currencies must contain upper-case ISO 4217 codes.');
        return entry;
      });
      if (new Set(currencies).size !== currencies.length)
        throw invalidRule('currencies must not repeat a code.');
      return currencies;
    }
    case 'referenceScope':
      if (rule !== 'any' && !fieldScopes.includes(rule as FieldScope))
        throw invalidRule('referenceScope must be item, storage_node or any.');
      return rule;
    case 'min':
    case 'max':
      return dataType === 'date'
        ? requireDate(rule)
        : dataType === 'datetime'
          ? requireDateTime(rule)
          : requireDecimal(rule, dataType === 'money' ? 4 : 10);
  }
}

function requireDate(rule: unknown): string {
  if (typeof rule !== 'string' || !parseCalendarDate(rule))
    throw invalidRule('Date bounds must use the YYYY-MM-DD calendar format.');
  return rule;
}

function requireDateTime(rule: unknown): string {
  const normalized = typeof rule === 'string' ? parseInstant(rule) : null;
  if (!normalized) throw invalidRule('Date-time bounds must use an ISO 8601 instant.');
  return normalized;
}

function requireDecimal(rule: unknown, scale: number): string {
  const normalized = typeof rule === 'string' || typeof rule === 'number' ? decimal(rule) : null;
  if (!normalized || fractionDigits(normalized) > scale)
    throw invalidRule(`Numeric bounds must be decimals with at most ${scale} fraction digits.`);
  return normalized;
}

function invalidRule(message: string): SchemaPolicyError {
  return new SchemaPolicyError('SCHEMA_FIELD_INVALID_VALIDATION_RULE', message);
}

export interface FieldValueShape {
  key: string;
  dataType: FieldDataType;
  repeatable: boolean;
  required: boolean;
  validation: ValidationRules;
}

/**
 * Converts an API-shaped value into ordered canonical rows. Multiselect and repeatable fields
 * accept arrays; every other field accepts a single value. Arrays exist only at this boundary.
 */
export function canonicalizeFieldValues(
  field: FieldValueShape,
  raw: unknown,
): CanonicalFieldValue[] {
  const many = field.repeatable || field.dataType === 'multiselect';
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    if (!many) throw issue(field.key, 'NOT_REPEATABLE');
    return raw.map((entry) => {
      if (entry === null || entry === undefined) throw issue(field.key, 'TYPE_MISMATCH');
      return canonicalizeSingle(field, entry);
    });
  }
  return [canonicalizeSingle(field, raw)];
}

function canonicalizeSingle(field: FieldValueShape, raw: unknown): CanonicalFieldValue {
  switch (field.dataType) {
    case 'text':
    case 'long_text':
    case 'url':
    case 'email': {
      if (typeof raw !== 'string') throw issue(field.key, 'TYPE_MISMATCH');
      const text = field.dataType === 'long_text' ? raw.trim() : raw.trim().replace(/\s+/gu, ' ');
      if (!text) throw issue(field.key, 'TYPE_MISMATCH');
      return { slot: 'text', text };
    }
    case 'number': {
      if (typeof raw !== 'string' && typeof raw !== 'number')
        throw issue(field.key, 'TYPE_MISMATCH');
      const number = decimal(raw);
      if (!number || fractionDigits(number) > 10 || integerDigits(number) > 20)
        throw issue(field.key, 'INVALID_NUMBER');
      return { slot: 'number', number };
    }
    case 'boolean':
      if (typeof raw !== 'boolean') throw issue(field.key, 'TYPE_MISMATCH');
      return { slot: 'boolean', boolean: raw };
    case 'date': {
      if (typeof raw !== 'string' || !parseCalendarDate(raw))
        throw issue(field.key, 'INVALID_DATE');
      return { slot: 'date', date: raw };
    }
    case 'datetime': {
      const instant = typeof raw === 'string' ? parseInstant(raw) : null;
      if (!instant) throw issue(field.key, 'INVALID_DATETIME');
      return { slot: 'datetime', datetime: instant };
    }
    case 'select':
    case 'multiselect':
      if (typeof raw !== 'string' || !uuidPattern.test(raw))
        throw issue(field.key, 'UNKNOWN_OPTION');
      return { slot: 'option', optionId: raw };
    case 'money': {
      if (!isRecord(raw)) throw issue(field.key, 'TYPE_MISMATCH');
      const amount =
        typeof raw.amount === 'string' || typeof raw.amount === 'number'
          ? decimal(raw.amount)
          : null;
      if (!amount || fractionDigits(amount) > 4 || integerDigits(amount) > 16)
        throw issue(field.key, 'INVALID_NUMBER');
      if (typeof raw.currency !== 'string' || !currencyPattern.test(raw.currency))
        throw issue(field.key, 'INVALID_CURRENCY');
      return { slot: 'money', amount, currency: raw.currency };
    }
    case 'reference': {
      if (!isRecord(raw)) throw issue(field.key, 'TYPE_MISMATCH');
      const scope = raw.scope;
      const id = raw.id;
      if (typeof id !== 'string' || !uuidPattern.test(id))
        throw issue(field.key, 'INVALID_REFERENCE');
      if (scope === 'item') return { slot: 'referenceItem', itemId: id };
      if (scope === 'storage_node') return { slot: 'referenceNode', nodeId: id };
      throw issue(field.key, 'INVALID_REFERENCE');
    }
  }
}

/** Rebuilds the API projection. Multiselect and repeatable fields project as ordered arrays. */
export function projectFieldValues(
  field: FieldValueShape,
  values: readonly CanonicalFieldValue[],
): unknown {
  const many = field.repeatable || field.dataType === 'multiselect';
  const projected = values.map((value) => projectSingle(value));
  if (many) return projected;
  return projected.length ? projected[0] : null;
}

function projectSingle(value: CanonicalFieldValue): unknown {
  switch (value.slot) {
    case 'text':
      return value.text;
    case 'number':
      return value.number;
    case 'boolean':
      return value.boolean;
    case 'date':
      return value.date;
    case 'datetime':
      return value.datetime;
    case 'option':
      return value.optionId;
    case 'money':
      return { amount: value.amount, currency: value.currency };
    case 'referenceItem':
      return { scope: 'item', id: value.itemId };
    case 'referenceNode':
      return { scope: 'storage_node', id: value.nodeId };
  }
}

/**
 * Applies cardinality and rule validation to already canonical values. Option membership is
 * validated by the persistence port, which is the only component that can read option rows.
 */
export function validateCanonicalValues(
  field: FieldValueShape,
  values: readonly CanonicalFieldValue[],
): AttributeIssue[] {
  const issues: AttributeIssue[] = [];
  const add = (code: AttributeIssueCode) => issues.push({ fieldKey: field.key, code });
  const many = field.repeatable || field.dataType === 'multiselect';

  if (!values.length) {
    if (field.required) add('REQUIRED');
    return issues;
  }
  if (!many && values.length > 1) add('NOT_REPEATABLE');
  if (values.some((value) => !valueSlotsFor(field.dataType).includes(value.slot)))
    add('TYPE_MISMATCH');
  if (field.dataType === 'multiselect') {
    const ids = values.flatMap((value) => (value.slot === 'option' ? [value.optionId] : []));
    if (new Set(ids).size !== ids.length) add('DUPLICATE_OPTION');
    const { minSelected, maxSelected } = field.validation;
    if (minSelected !== undefined && ids.length < minSelected) add('TOO_FEW_SELECTED');
    if (maxSelected !== undefined && ids.length > maxSelected) add('TOO_MANY_SELECTED');
  }
  for (const value of values) issues.push(...ruleIssues(field, value));
  return dedupe(issues);
}

function ruleIssues(field: FieldValueShape, value: CanonicalFieldValue): AttributeIssue[] {
  const rules = field.validation;
  const issues: AttributeIssue[] = [];
  const add = (code: AttributeIssueCode) => issues.push({ fieldKey: field.key, code });
  if (value.slot === 'text') {
    const length = [...value.text].length;
    if (rules.minLength !== undefined && length < rules.minLength) add('TOO_SHORT');
    if (rules.maxLength !== undefined && length > rules.maxLength) add('TOO_LONG');
    if (rules.pattern !== undefined && !new RegExp(rules.pattern, 'u').test(value.text))
      add('PATTERN_MISMATCH');
    if (field.dataType === 'url' && !isHttpUrl(value.text)) add('INVALID_URL');
    if (field.dataType === 'email' && !isEmail(value.text)) add('INVALID_EMAIL');
  }
  if (value.slot === 'number') {
    if (rules.integer && fractionDigits(value.number) > 0) add('NOT_INTEGER');
    if (outOfRange(compareDecimal, value.number, rules)) add('OUT_OF_RANGE');
  }
  if (value.slot === 'money') {
    if (outOfRange(compareDecimal, value.amount, rules)) add('OUT_OF_RANGE');
    if (rules.currencies && !rules.currencies.includes(value.currency)) add('INVALID_CURRENCY');
  }
  if (value.slot === 'date' && outOfRange(compareText, value.date, rules)) add('OUT_OF_RANGE');
  if (value.slot === 'datetime' && outOfRange(compareText, value.datetime, rules))
    add('OUT_OF_RANGE');
  if (
    (value.slot === 'referenceItem' && rules.referenceScope === 'storage_node') ||
    (value.slot === 'referenceNode' && rules.referenceScope === 'item')
  )
    add('INVALID_REFERENCE');
  return issues;
}

function outOfRange(
  comparator: (left: string, right: string) => number,
  value: string,
  rules: ValidationRules,
): boolean {
  return (
    (rules.min !== undefined && comparator(value, rules.min) < 0) ||
    (rules.max !== undefined && comparator(value, rules.max) > 0)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Compares decimal strings exactly; `numeric(30, 10)` exceeds the safe float range. */
export function compareDecimal(left: string, right: string): number {
  const [leftSign, leftDigits, leftFraction] = splitDecimal(left);
  const [rightSign, rightDigits, rightFraction] = splitDecimal(right);
  if (leftSign !== rightSign) return leftSign < rightSign ? -1 : 1;
  const magnitude =
    leftDigits.length !== rightDigits.length
      ? leftDigits.length - rightDigits.length
      : compareText(leftDigits, rightDigits) ||
        compareText(
          leftFraction.padEnd(rightFraction.length, '0'),
          rightFraction.padEnd(leftFraction.length, '0'),
        );
  return magnitude === 0 ? 0 : (magnitude > 0 ? 1 : -1) * leftSign;
}

function splitDecimal(value: string): [number, string, string] {
  const [rawDigits = '0', rawFraction = ''] = value.replace(/^[+-]/u, '').split('.');
  const digits = rawDigits.replace(/^0+(?=\d)/u, '');
  const fraction = rawFraction.replace(/0+$/u, '');
  // Negative zero compares equal to zero, so zero is always sign-neutral.
  const sign = value.startsWith('-') && (digits !== '0' || fraction !== '') ? -1 : 1;
  return [sign, digits, fraction];
}

/** Normalizes a decimal literal, or returns null when the input is not a finite decimal. */
export function decimal(value: string | number): string | null {
  const text =
    typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
  if (!/^[+-]?(?:\d+)(?:\.\d+)?$/u.test(text)) return null;
  const [sign, digits, fraction] = splitDecimal(text);
  const normalized = fraction ? `${digits}.${fraction}` : digits;
  return sign < 0 ? `-${normalized}` : normalized;
}

function fractionDigits(value: string): number {
  return splitDecimal(value)[2].length;
}

function integerDigits(value: string): number {
  return splitDecimal(value)[1].length;
}

export function parseCalendarDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

export function parseInstant(value: string): string | null {
  if (
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  )
    return null;
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s@"'<>,;:\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/iu.test(
      value,
    )
  );
}

function dedupe(issues: readonly AttributeIssue[]): AttributeIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.fieldKey}:${entry.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function issue(fieldKey: string, code: AttributeIssueCode): AttributeValidationError {
  return new AttributeValidationError([{ fieldKey, code }]);
}

/**
 * Normalizes the definition default into canonical rows validated like a stored value. A default
 * is accepted as the field's API shape or as the ordered array the API always projects back.
 */
export function normalizeDefaultValue(
  field: FieldValueShape,
  raw: unknown,
): CanonicalFieldValue[] | null {
  if (raw === null || raw === undefined) return null;
  let values: CanonicalFieldValue[];
  try {
    values = canonicalizeFieldValues(
      { ...field, repeatable: true },
      Array.isArray(raw) ? raw : [raw],
    );
  } catch (error) {
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_INVALID_DEFAULT',
      error instanceof AttributeValidationError
        ? `The default value is invalid: ${error.issues[0]?.code}.`
        : 'The default value is invalid.',
    );
  }
  const issues = validateCanonicalValues({ ...field, required: false }, values).filter(
    (entry) => entry.code !== 'REQUIRED',
  );
  if (issues.length)
    throw new SchemaPolicyError(
      'SCHEMA_FIELD_INVALID_DEFAULT',
      `The default value is invalid: ${issues[0]!.code}.`,
    );
  return values;
}

export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
