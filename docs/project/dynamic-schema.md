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
