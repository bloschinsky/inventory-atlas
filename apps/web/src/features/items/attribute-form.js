/**
 * Shared draft/serialization rules for the Item attribute form. Create and edit use the same
 * conversion in both directions so a value that survives a round trip is byte-identical.
 */

/** @typedef {Record<string, unknown>} FieldDefinition */

/** @param {unknown} value */
export function isEmptyValue(value) {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmptyValue);
  if (typeof value === 'object' && 'amount' in value)
    return value.amount === null || value.amount === '';
  if (typeof value === 'object' && 'id' in value) return !value.id;
  return false;
}

/** @param {FieldDefinition} definition */
function acceptsMany(definition) {
  return Boolean(definition.repeatable) || definition.dataType === 'multiselect';
}

/** @param {FieldDefinition} definition @param {unknown} value */
export function serializeValue(definition, value) {
  if (value instanceof Date) {
    if (definition.dataType === 'date')
      return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 10);
    return value.toISOString();
  }
  if (definition.dataType === 'money' && value && typeof value === 'object') {
    const money = /** @type {{ amount: unknown, currency: unknown }} */ (value);
    return {
      ...money,
      amount: String(money.amount),
      currency: String(money.currency).toUpperCase(),
    };
  }
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Converts the local draft into the request payload, skipping empty values.
 * @param {readonly FieldDefinition[]} definitions
 * @param {Record<string, unknown>} attributes
 */
export function serializeAttributes(definitions, attributes) {
  return Object.fromEntries(
    definitions.flatMap((definition) => {
      const raw = attributes[String(definition.key)];
      if (isEmptyValue(raw)) return [];
      const value = Array.isArray(raw)
        ? raw
            .filter((entry) => !isEmptyValue(entry))
            .map((entry) => serializeValue(definition, entry))
        : serializeValue(definition, raw);
      return [[String(definition.key), value]];
    }),
  );
}

/** @param {FieldDefinition} definition @param {unknown} stored */
function draftSingle(definition, stored) {
  if ((definition.dataType === 'date' || definition.dataType === 'datetime') && stored)
    return new Date(String(stored));
  return stored;
}

/**
 * Rebuilds the local draft from an API value so the edit form renders the stored state.
 * @param {FieldDefinition} definition
 * @param {unknown} stored
 */
export function draftFromStored(definition, stored) {
  if (stored === null || stored === undefined) return acceptsMany(definition) ? [] : null;
  const values = Array.isArray(stored) ? stored : [stored];
  const drafted = values.map((value) => draftSingle(definition, value));
  return acceptsMany(definition) ? drafted : drafted[0];
}

/** Builds the draft a definition default implies for a brand-new Item. */
export function draftFromDefault(/** @type {FieldDefinition} */ definition) {
  return draftFromStored(definition, definition.defaultValue);
}

/** @param {string} value */
export function parseTags(value) {
  return [
    ...new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

/** @param {readonly string[] | undefined | null} tags */
export function formatTags(tags) {
  return (tags ?? []).join(', ');
}
