# Dynamic field schema and typed EAV

CAT-02 introduces the Schema module: administrator-defined field definitions and
options for the `item` and `storage_node` scopes, plus the typed scalar value
store that Item and StorageNode aggregates write through a transaction-aware
port. Kysely migration `0005_dynamic_schema` owns the tables, checks, partial
unique indexes and immutable-identity triggers. Prisma owns definition and
option reads and writes.

## Approved data types

The twelve approved `data_type` values map to exactly one typed value slot:

| `data_type` | Typed slot | Notes |
| --- | --- | --- |
| `text`, `long_text`, `url`, `email` | `value_text` | `long_text` is multi-line; `url` and `email` add format validation |
| `number` | `value_number` | `numeric(30, 10)`; `validation.integer` narrows it to whole numbers |
| `boolean` | `value_boolean` | |
| `date` | `value_date` | Calendar date without a time zone |
| `datetime` | `value_datetime` | Stored as UTC `timestamptz` |
| `select` | `value_option_id` | Exactly one active option row at `position = 0` |
| `multiselect` | `value_option_id` | One ordered row per selected option |
| `money` | `value_money_amount` + `value_money_currency` | Both set or both null; ISO 4217 upper-case currency |
| `reference` | `value_reference_item_id` or `value_reference_node_id` | Exactly one reference slot per row |

`integer` and `decimal` are not approved data types; both are expressed as
`number` with `validation.integer`. The Stage-0 fixture
`db/fixtures/catalog/categories-fields.en-uk.json` still uses the pre-blueprint
`integer`/`decimal`/`publicVisibility` vocabulary and is not a contract source;
the blueprint outranks it in the source-of-truth order.

## Definition rules

- Stable keys use lower-case letters, digits and underscores, start with a
  letter, and never change. `scope` is immutable for the same reason: existing
  values are addressed by definition, and a scope change would orphan them.
- `label_i18n` and optional `help_i18n` contain only `en` and optional `uk`.
  English is required and non-empty.
- Applicability is `scope` plus optional `category_id`. A definition without a
  category applies to the whole scope; a definition with a category applies only
  to that category. Active keys are unique per `(scope, category_id, key)`.
- `required`, `repeatable`, `searchable`, `filterable` and `sortable` default to
  `false`. `visibility` defaults to `authenticated`, never `public`.
- `repeatable = true` is rejected for `select` and `multiselect` by the database
  and by the application policy; use `multiselect` when several options are
  allowed.
- `unit`, `default_value_json` and `validation_json` are optional. Validation
  rules are a closed per-type set and unknown rule keys are rejected.
- Mutable rows start at version 1. Updates and archives require the expected
  version and increment it once.

## Option rules

Options are children of their definition, not independent aggregates. They carry
no version column: the parent definition version governs optimistic concurrency
for every option write, and an option change increments that definition version.
Option keys and owner fields are immutable, active keys are unique per
definition, and archived options stay resolvable so historical values keep their
label.

## Typed value persistence

`attribute_values` is the only persistence form for dynamic values (ADR-024).
Every row stores:

- exactly one owner, `item_id` or `storage_node_id`;
- exactly one populated typed value group;
- a required non-negative `position`, the only multiplicity mechanism.

Canonical multiplicity:

- Non-repeatable scalar and `select` fields store one row at `position = 0`.
- Repeatable scalar fields store contiguous positions `0..N-1`.
- `multiselect` stores one `value_option_id` row per selected option with
  contiguous positions and no duplicate option.

Database guarantees: one owner, one value group, money amount/currency together,
`position >= 0`, uniqueness per `(owner, field_definition_id, position)`, and
uniqueness per `(owner, field_definition_id, value_option_id)`. Option ownership
is a declarative composite foreign key from
`(value_option_id, field_definition_id)` to
`field_options (id, field_definition_id)`, so a wrong-field option cannot be
stored even by direct SQL. No array-typed column exists anywhere in the table;
API payloads and search projections assemble multiselect arrays at the boundary.

`item_id`, `storage_node_id`, `value_reference_item_id` and
`value_reference_node_id` are indexed and receive their real foreign keys in the
migrations that create `items` (CAT-03) and `storage_nodes` (STO-01), because
both stories depend on this schema and their tables cannot exist earlier. The
CAT-02 integration suite asserts those foreign keys as soon as the owner tables
appear, so the later migrations cannot omit them.

## Validation engine

`field-policy.ts` owns the domain rules that every persistence path shares:
the approved data-type list, the typed slot mapping above, the canonical value
serializer, and a closed validation-rule set per data type.

| Data type | Accepted `validation_json` rules |
| --- | --- |
| `text`, `long_text`, `url`, `email` | `minLength`, `maxLength`, `pattern` |
| `number` | `min`, `max`, `integer` |
| `date`, `datetime` | `min`, `max` |
| `money` | `min`, `max`, `currencies` |
| `multiselect` | `minSelected`, `maxSelected` |
| `reference` | `referenceScope` |
| `boolean`, `select` | none |

An unknown rule name is rejected rather than ignored, so a typo cannot silently
disable validation. `pattern` must be a valid Unicode expression, `currencies`
must be distinct upper-case ISO 4217 codes, and numeric bounds are compared as
exact decimal strings because `numeric(30, 10)` exceeds the safe float range.
`default_value_json` stores canonical rows and is validated by the same engine
as a stored value.

Value failures raise `AttributeValidationError` carrying the stable field key and
an issue code (`REQUIRED`, `TYPE_MISMATCH`, `UNKNOWN_OPTION`, `ARCHIVED_OPTION`,
`OUT_OF_RANGE`, and so on). Codes never contain a value, so an error is safe to
return, log and localize.

## `AttributeValuePort`

`TransactionalAttributeValuePort.replace` writes only `attribute_values`, inside
the transaction its caller supplies. It never opens a transaction and never
returns a Schema domain row. Both branches run the same parameterized
statements: two `SELECT`s that resolve the applicable definitions and their
options for the owner's scope and category, one owner-scoped `DELETE`, and one
`INSERT` per canonical value. `planAttributeRows` is a pure function, so the
whole validation surface is unit-tested without a database, and the integration
parity suite proves a Prisma-source item write and a Kysely-source node write
produce identical rows.

The port enforces what the database cannot: the populated slot matches the
definition's `data_type`, option identifiers belong to the field and are not
archived, cardinality follows the canonical multiplicity rules, and every
required applicable definition has a value. Positions are assigned from the
supplied order, so stored positions are always contiguous from zero. Replacement
covers the complete attribute set of one owner and leaves other owners untouched.
A rollback of the source transaction rolls the attribute rows back with it.

General attribute reads stay Prisma-owned in `FieldDefinitionRepository`, which
rejects a non-contiguous position set as corruption rather than projecting it.

## Definition versions, audit and reindex warnings

Every definition mutation requires the expected version, increments it exactly
once, and records an audit event whose `before_json`/`after_json` hold the full
definition snapshot for that version. Those snapshots are the definition-version
history; a stored default value is reduced to `hasDefaultValue` so no field value
enters audit. Option writes require the parent definition's expected version and
bump it, so the same snapshot chain covers option changes.

A change to `visibility`, `searchable`, `filterable`, `sortable` or the label,
and archiving a definition, warn the caller (`massReindexRequired` with the list
of reasons) and enqueue one deduplicated `FieldDefinitionChanged` message on
`search.rebuild-items.v1` through the transaction-aware `OutboxPort`. Ordering,
unit, help, required, default and validation-only edits enqueue nothing. An
option label change enqueues `FieldOptionLabelChanged`; creating or reordering an
option does not, because no existing value changes meaning. If the audit or
outbox write fails, the definition mutation rolls back.

## Type changes and conversion preview

A data-type change is applied directly only while the definition has no stored
value and the conversion pair is supported. With values present the update is
rejected with `SCHEMA_FIELD_CONVERSION_REQUIRED`; CAT-02 previews the impact and
never mutates values destructively.

Supported pairs: any type to a text type; text types to `number`, `boolean`,
`date` or `datetime`; `date` to `datetime` and back; and `select` to
`multiselect` and back. Conversions *into* `select`, `multiselect` or `money`
are unsupported because they need new options or a target currency, which is an
explicit plan rather than a preview. `reference` never converts. Leaving an
option data type also requires the remaining options to be archived first.

`POST /field-definitions/{id}/conversion-preview` re-canonicalizes stored values
with the same serializer a conversion would use and reports `totalValues`,
`analyzedValues`, `convertibleValues`, `blockingValues`, a `truncated` flag when
the analysis limit is reached, `lossless`, `requiresBackgroundConversion`, and
the distinct blocking issue codes. It returns counts and codes only; a stored
value never appears in the preview.
