# Migrations

Kysely is the sole migration authority. `0001_foundation.mjs` creates the typed
installation-setting store required by FND-02. Run all pending migrations with
`pnpm db:migrate`; deployment runs the same migration code in the one-shot
`migrate` container before starting the API.

`0002_auth.mjs` starts FND-04A with users, hashed-token session/invitation stores,
and append-only audit events. Existing settings and initialization metadata are
preserved. Auth tables use application-generated UUIDs, UTC timestamps, checked
roles/locales/states, unique normalized emails and token hashes, and indexes for
session management, expiry cleanup, invitations and audit queries. Token/CSRF/IP
digests use 64-character lowercase hexadecimal SHA-256 representations; token
generation and credential verification belong to the later Auth implementation.
The password column checks the Argon2id prefix only, not cryptographic validity.

User records are archived rather than hard-deleted. Foreign keys restrict deletion
of referenced users; audit actor IDs are nullable for anonymous events. Audit
triggers reject UPDATE, DELETE and TRUNCATE while allowing transaction rollback.
The future AuditPort must allowlist safe before/after fields: JSON object checks
do not establish that a payload is free of secrets. Database administrators can
still alter schema/triggers; this is not a tamper-proof external audit store.

Run `pnpm test:integration` against real PostgreSQL to exercise clean creation,
upgrade with existing settings, invalid values, concurrent email uniqueness,
foreign keys, audit immutability, rollback and reapplication. Rollback drops the
new Auth/Audit tables and their data; use it only on disposable test databases or
as an explicitly planned destructive operation. It leaves FND-02 settings intact.
Migration metadata is scoped to the connection's current PostgreSQL schema so
parallel isolated test schemas cannot be mistaken for one another.

`0003_catalog_dictionaries.mjs` starts CAT-01 with the category tree and lifecycle
status dictionary. It enforces stable lower-case keys, English-first `en`/`uk`
label objects, deterministic non-negative ordering, positive versions, archive
timestamps, semantic lifecycle color tokens, and acyclic category parents.
Database triggers reject key changes even when a write bypasses the Prisma
repository. The generated Prisma schema/client is checked against the migrated
database by the drift suite.

Run `pnpm db:seed` after migration to add the approved lifecycle keys. The seed is
idempotent: it inserts missing rows and preserves labels, colors, ordering, and
archive state already edited by an administrator. Rollback drops both dictionary
tables and their data, so it is limited to disposable databases or a planned
recovery operation.

`0004_outbox.mjs` adds the Kysely-owned transactional outbox required by CAT-01C.
It stores versioned JSON object payloads, unique deduplication keys, publication
and retry metadata, plus pending and aggregate access indexes. Prisma-owned source
transactions may only insert through the narrow parameterized `OutboxPort`; the
Prisma model is ignored for generated CRUD access. Job claiming and outbox
dispatch remain part of the shared Jobs workstream.

`0005_dynamic_schema.mjs` starts CAT-02A with the Schema module tables:
`field_definitions`, `field_options`, and the typed scalar `attribute_values`
store. Definitions carry a stable lower-case key, `item`/`storage_node` scope,
optional category applicability, English-first bilingual label and help objects,
one of the twelve approved data types, required/repeatable/searchable/filterable/
sortable flags, `public`/`authenticated`/`private` visibility, unit, default and
validation JSON objects, ordering, archive timestamp, and an optimistic version.
Active keys are unique per `(scope, category_id, key)` through two partial unique
indexes, one for category-scoped and one for scope-wide definitions. The database
rejects `repeatable = true` for `select` and `multiselect`, and a trigger rejects
key or scope changes even when a write bypasses the repository.

Options are children of their definition: they have no independent version, and
the parent definition version governs optimistic concurrency for option writes.
Active option keys are unique per definition, and a trigger keeps the key and
owner field immutable. Archived options remain resolvable for historical values.

`attribute_values` stores exactly one owner (`item_id` or `storage_node_id`),
one populated typed value group, a required non-negative `position`, and a money
amount/currency pair that is set or null together. Positions are unique per
`(owner, field_definition_id, position)` and option rows are unique per
`(owner, field_definition_id, value_option_id)`, both through per-owner partial
unique indexes. Option ownership is enforced declaratively by a composite
foreign key from `(value_option_id, field_definition_id)` to
`field_options (id, field_definition_id)`, so a wrong-field option cannot be
stored even by direct SQL. Multiselect therefore persists as ordered scalar
option rows; no UUID array column exists.

`item_id`, `storage_node_id`, `value_reference_item_id` and
`value_reference_node_id` are indexed but receive their real foreign keys in the
migrations that create `items` (CAT-03) and `storage_nodes` (STO-01). Those
tables cannot exist earlier because both stories depend on this schema. The
CAT-02 integration suite asserts the foreign keys as soon as the owner tables
appear, so a later migration cannot forget them.

Rollback drops the three tables and their data; use it only on disposable
databases or as a planned destructive operation. It leaves the CAT-01
dictionaries intact.

`0006_item_aggregate.mjs` starts CAT-03A with Prisma-owned `items`, `tags`, and
`item_tags`, plus the Kysely-owned movement history, synchronous `item_search`
read model, and idempotency reservation store. Item public IDs are unique UUIDs
and an update trigger makes them immutable; slugs are decorative URL-safe text.
The migration adds the real Item owner/reference foreign keys promised by
CAT-02. Storage-node foreign keys and destination path locking are added by
STO-01 when `storage_nodes` exists.

Movement rows are append-only. Search projections include separate authenticated
and public vectors/attribute objects, while privacy-safe construction stays in
`SearchProjectionPort`. Idempotency keys and fingerprints are stored only as
SHA-256 hashes; completion must update the matching live reservation from the
source transaction. Rollback drops all CAT-03 tables and Item attribute foreign
keys and therefore destroys Item, tag, movement, projection, and idempotency data;
use it only on disposable databases or as part of a planned restore.
