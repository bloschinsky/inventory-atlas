/**
 * Schema module domain policy for display-name templates (blueprint section 9.3).
 *
 * The grammar is a closed token substitution language, deliberately not an expression language:
 * a template is literal text interleaved with `{{stable_key}}` tokens and nothing else. There is
 * no loop, no conditional, no property path, no function call, and no way to reach a value the
 * resolver was not given. One renderer serves both the preview endpoint and the persisted Item
 * mutation path, so a preview can never disagree with what is stored.
 */

import type {
  CanonicalFieldValue,
  FieldDataType,
  FieldVisibility,
  LocalizedText,
} from './field-policy.js';

export const displayTemplateLimits = Object.freeze({
  /** Longest accepted template source. */
  maxLength: 500,
  /** Most tokens one template may contain. */
  maxTokens: 12,
  /** Longest rendered display name; the renderer truncates deterministically at this length. */
  maxRenderedLength: 200,
});

/** Core aggregate tokens a template may use in addition to item-scoped field keys. */
export const coreDisplayTokens = ['category', 'status'] as const;
export type CoreDisplayToken = (typeof coreDisplayTokens)[number];

/**
 * Data types a token may reference. `boolean` and `reference` are excluded because neither has a
 * deterministic, human-meaningful text form: a boolean renders as a UI word that depends on the
 * viewer's locale, and a reference renders as an opaque identifier.
 */
export const displayTemplateDataTypes = [
  'text',
  'long_text',
  'url',
  'email',
  'number',
  'date',
  'datetime',
  'select',
  'multiselect',
  'money',
] as const;

/** Characters that may never appear in literal template text. */
const forbiddenLiteral = /[<>&`$\\|{}]|[\p{Cc}\p{Cf}]/u;
/** Literal runs made only of these characters are dropped when a neighbouring token is missing. */
const separatorOnly = /^[\s\-–—/,.:;#()[\]]*$/u;
const trimSeparators = /^[\s\-–—/,.:;|]+|[\s\-–—/,.:;|]+$/gu;
const tokenPattern = /^[a-z][a-z0-9_]{0,63}$/u;

export type DisplayTemplateIssueCode =
  | 'TEMPLATE_EMPTY'
  | 'TEMPLATE_TOO_LONG'
  | 'TEMPLATE_TOO_MANY_TOKENS'
  | 'TEMPLATE_NO_TOKEN'
  | 'TEMPLATE_FORBIDDEN_CHARACTER'
  | 'TEMPLATE_UNTERMINATED_TOKEN'
  | 'TEMPLATE_INVALID_TOKEN'
  | 'TEMPLATE_UNKNOWN_TOKEN'
  | 'TEMPLATE_PRIVATE_TOKEN'
  | 'TEMPLATE_UNSUPPORTED_TOKEN_TYPE';

export interface DisplayTemplateIssue {
  code: DisplayTemplateIssueCode;
  /** Stable token key when the issue is about one token. */
  token?: string;
}

export class DisplayTemplateError extends Error {
  constructor(readonly issues: readonly DisplayTemplateIssue[]) {
    super('The display-name template is invalid.');
    this.name = 'DisplayTemplateError';
  }
}

export type DisplayTemplateSegment =
  { kind: 'literal'; text: string } | { kind: 'token'; key: string };

/** The token surface the resolver knows about, independent of the repository row shape. */
export interface DisplayTokenField {
  key: string;
  dataType: FieldDataType;
  repeatable: boolean;
  visibility: FieldVisibility;
  options?: readonly { id: string; labels: LocalizedText }[];
}

/**
 * Adapts a stored field definition to the token surface. Archived options are dropped so a
 * retired option renders as missing instead of resurrecting its label.
 */
export function toDisplayTokenField(definition: {
  key: string;
  dataType: FieldDataType;
  repeatable: boolean;
  visibility: FieldVisibility;
  options: readonly { id: string; labels: LocalizedText; archivedAt: Date | null }[];
}): DisplayTokenField {
  return {
    key: definition.key,
    dataType: definition.dataType,
    repeatable: definition.repeatable,
    visibility: definition.visibility,
    options: definition.options
      .filter((option) => !option.archivedAt)
      .map((option) => ({ id: option.id, labels: option.labels })),
  };
}

export interface DisplayNameSource {
  locale: 'en' | 'uk';
  /** Localized labels for the core tokens; `null` renders as a missing value. */
  core?: Readonly<Partial<Record<CoreDisplayToken, LocalizedText | null>>>;
  fields: readonly DisplayTokenField[];
  /** Canonical stored values keyed by stable field key. */
  values?: Readonly<Record<string, readonly CanonicalFieldValue[]>>;
}

export interface DisplayTokenDescription {
  key: string;
  kind: 'core' | 'field';
  /** Localized label for the Admin editor; core tokens carry their dictionary label. */
  labels: LocalizedText | null;
  dataType: FieldDataType | null;
}

/**
 * Parses the template structure. This stage knows nothing about the category's fields: it
 * enforces the grammar, the forbidden characters and the size limits only, so it can run wherever
 * a template is accepted, including before the field definitions are known.
 */
export function parseDisplayTemplate(value: unknown): DisplayTemplateSegment[] {
  if (typeof value !== 'string' || value.trim() === '')
    throw new DisplayTemplateError([{ code: 'TEMPLATE_EMPTY' }]);
  const source = value.trim();
  if (source.length > displayTemplateLimits.maxLength)
    throw new DisplayTemplateError([{ code: 'TEMPLATE_TOO_LONG' }]);

  const issues: DisplayTemplateIssue[] = [];
  const segments: DisplayTemplateSegment[] = [];
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf('{{', index);
    if (start === -1) {
      pushLiteral(segments, issues, source.slice(index));
      break;
    }
    pushLiteral(segments, issues, source.slice(index, start));
    const end = source.indexOf('}}', start + 2);
    if (end === -1) {
      issues.push({ code: 'TEMPLATE_UNTERMINATED_TOKEN' });
      break;
    }
    const key = source.slice(start + 2, end).trim();
    if (!tokenPattern.test(key)) issues.push({ code: 'TEMPLATE_INVALID_TOKEN', token: key });
    else segments.push({ kind: 'token', key });
    index = end + 2;
  }

  const tokens = segments.filter((segment) => segment.kind === 'token');
  if (!issues.length && !tokens.length) issues.push({ code: 'TEMPLATE_NO_TOKEN' });
  if (tokens.length > displayTemplateLimits.maxTokens)
    issues.push({ code: 'TEMPLATE_TOO_MANY_TOKENS' });
  if (issues.length) throw new DisplayTemplateError(dedupe(issues));
  return segments;
}

/**
 * Resolves the parsed tokens against the category's fields. A token that names no active field,
 * names a private field, or names an unsupported data type is rejected here rather than silently
 * skipped at render time. Private values are refused because the rendered name reaches public
 * projections, cards, labels and search vectors.
 */
export function validateDisplayTemplate(
  value: unknown,
  fields: readonly DisplayTokenField[],
): DisplayTemplateSegment[] {
  const segments = parseDisplayTemplate(value);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const issues: DisplayTemplateIssue[] = [];
  for (const segment of segments) {
    if (segment.kind !== 'token') continue;
    if (isCoreToken(segment.key)) continue;
    const field = byKey.get(segment.key);
    if (!field) {
      issues.push({ code: 'TEMPLATE_UNKNOWN_TOKEN', token: segment.key });
      continue;
    }
    if (field.visibility === 'private')
      issues.push({ code: 'TEMPLATE_PRIVATE_TOKEN', token: segment.key });
    else if (!displayTemplateDataTypes.includes(field.dataType as never))
      issues.push({ code: 'TEMPLATE_UNSUPPORTED_TOKEN_TYPE', token: segment.key });
  }
  if (issues.length) throw new DisplayTemplateError(dedupe(issues));
  return segments;
}

export function displayTemplateTokens(segments: readonly DisplayTemplateSegment[]): string[] {
  return [
    ...new Set(segments.flatMap((segment) => (segment.kind === 'token' ? [segment.key] : []))),
  ];
}

/** Describes each token for the Admin editor without disclosing any stored value. */
export function describeDisplayTokens(
  segments: readonly DisplayTemplateSegment[],
  fields: readonly DisplayTokenField[],
  labels: Readonly<Partial<Record<CoreDisplayToken, LocalizedText | null>>> = {},
): DisplayTokenDescription[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  return displayTemplateTokens(segments).map((key) => {
    if (isCoreToken(key))
      return { key, kind: 'core' as const, labels: labels[key] ?? null, dataType: null };
    const field = byKey.get(key);
    return {
      key,
      kind: 'field' as const,
      labels: null,
      dataType: field?.dataType ?? null,
    };
  });
}

/**
 * Renders the cached display name. Missing tokens are skipped; a literal run made only of
 * separators is dropped unless rendered content survives on both sides of it, so a skipped token
 * never leaves a dangling dash. Whitespace collapses to single spaces and the result is trimmed
 * and truncated at the documented limit. The function is pure: the same source always produces
 * the same string.
 */
export function renderDisplayName(
  segments: readonly DisplayTemplateSegment[],
  source: DisplayNameSource,
): string {
  const rendered = segments.map((segment) =>
    segment.kind === 'literal' ? segment.text : resolveToken(segment.key, source),
  );
  const kept: string[] = [];
  for (const [index, text] of rendered.entries()) {
    const segment = segments[index]!;
    if (segment.kind === 'token') {
      if (text) kept.push(text);
      continue;
    }
    if (!separatorOnly.test(text)) {
      kept.push(text);
      continue;
    }
    // A separator survives only between two rendered values.
    if (kept.some((entry) => entry.trim()) && hasContentAfter(segments, rendered, index))
      kept.push(text);
  }
  const collapsed = kept.join('').replace(/\s+/gu, ' ').replace(trimSeparators, '');
  if (collapsed.length <= displayTemplateLimits.maxRenderedLength) return collapsed;
  return collapsed.slice(0, displayTemplateLimits.maxRenderedLength).replace(trimSeparators, '');
}

function hasContentAfter(
  segments: readonly DisplayTemplateSegment[],
  rendered: readonly string[],
  index: number,
): boolean {
  for (let next = index + 1; next < segments.length; next += 1) {
    const text = rendered[next] ?? '';
    if (segments[next]!.kind === 'token' ? Boolean(text) : !separatorOnly.test(text)) return true;
  }
  return false;
}

function resolveToken(key: string, source: DisplayNameSource): string {
  if (isCoreToken(key)) return localized(source.core?.[key] ?? null, source.locale);
  const field = source.fields.find((entry) => entry.key === key);
  const values = source.values?.[key];
  if (!field || !values?.length) return '';
  return values
    .map((value) => formatValue(field, value, source.locale))
    .filter(Boolean)
    .join(', ');
}

function formatValue(
  field: DisplayTokenField,
  value: CanonicalFieldValue,
  locale: 'en' | 'uk',
): string {
  switch (value.slot) {
    case 'text':
      return value.text.trim();
    case 'number':
      return value.number;
    case 'date':
      return value.date;
    case 'datetime':
      return value.datetime;
    case 'money':
      return `${value.amount} ${value.currency}`;
    case 'option': {
      const option = field.options?.find((entry) => entry.id === value.optionId);
      return option ? localized(option.labels, locale) : '';
    }
    default:
      return '';
  }
}

function localized(labels: LocalizedText | null, locale: 'en' | 'uk'): string {
  if (!labels) return '';
  return (locale === 'uk' ? labels.uk?.trim() || labels.en : labels.en).trim();
}

function pushLiteral(
  segments: DisplayTemplateSegment[],
  issues: DisplayTemplateIssue[],
  text: string,
): void {
  if (!text) return;
  if (forbiddenLiteral.test(text)) {
    issues.push({ code: 'TEMPLATE_FORBIDDEN_CHARACTER' });
    return;
  }
  segments.push({ kind: 'literal', text });
}

function isCoreToken(key: string): key is CoreDisplayToken {
  return coreDisplayTokens.includes(key as CoreDisplayToken);
}

function dedupe(issues: readonly DisplayTemplateIssue[]): DisplayTemplateIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const identity = `${issue.code}:${issue.token ?? ''}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
