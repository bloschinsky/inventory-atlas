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
