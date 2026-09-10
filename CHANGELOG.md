# Changelog

All notable changes to Inventory Atlas will be documented in this file.

The project follows the version policy in `docs/project/versioning.md`.

## [Unreleased]

### Changed

- Aligned the Stage-0 catalog fixture with approved schema vocabulary: `integer`
  and `decimal` became `number` with `validation.integer`, `publicVisibility`
  became three-value `visibility`, `unit` became plain text, the category list
  became one optional `appliesToCategory`, ordering moved from `position` to
  `displayOrder`, and the lifecycle statuses now mirror the seeded keys.

- Approved the exact development-only Prisma Studio/elkjs license exception and restored Prisma CLI tooling. Patched YAML/esbuild and newly introduced CLI dependency advisories, added CI security/license/tooling gates, and separated backend production dependencies from build tooling with an image-content check.

### Added

- Completed CAT-04 with versioned Item editing: `PATCH /api/v1/items/{publicId}`
  enforces `If-Match` or `expectedVersion` through a compare-and-swap on the
  aggregate version, `GET /api/v1/items/{publicId}` serves the visibility-aware
  card the edit workflow reads, and both answer with an `ETag`. The update holds
  one Prisma transaction for the source row, typed values, the synchronous
  `item_search` projection, audit, movement, outbox and optional idempotency
  completion. A rejected edit returns `ITEM_VERSION_CONFLICT` with the current
  version and a diff limited to fields the actor may view, and a value whose
  private definition the actor cannot see is preserved rather than erased. The
  Item-scoped rows of the search invalidation registry moved into an explicit
  planner, and `/items/:publicId/edit` renders the compare, reload and discard
  workflow so a conflicted edit is never silently overwritten.

- Completed CAT-02C with the `/api/v1/field-definitions` REST surface, contract
  request bodies and path parameters, versioned option management through the
  parent definition, a conversion-preview endpoint, mass-reindex warnings on
  every mutation response, and the bilingual `/admin/fields` designer whose
  editor preview renders the real control for each data type.

- Continued CAT-02B with the Schema module validation engine and canonical EAV
  adapters: a closed per-type validation-rule set, one canonical value serializer
  shared by every persistence path, stable field-key issue codes,
  `TransactionalAttributeValuePort` with parity-tested Prisma and Kysely branches,
  Prisma-owned definition/option repositories with definition-version audit
  snapshots and optimistic concurrency, deduplicated `FieldDefinitionChanged` and
  `FieldOptionLabelChanged` rebuild messages with mass-reindex warnings, and
  non-destructive type-change impact analysis with a conversion preview.

- Started CAT-02A with the Kysely-owned Schema tables: constrained field
  definitions for the `item` and `storage_node` scopes with optional category
  applicability, all twelve approved data types, bilingual label/help objects,
  required/repeatable/searchable/filterable/sortable flags, visibility, unit,
  default and validation JSON, ordering, archive state and optimistic versions;
  field options with active-key uniqueness and immutable identity; and the typed
  scalar `attribute_values` store with one-owner, one-value-group, money-pair,
  position and per-owner uniqueness checks plus a composite option-ownership
  foreign key that makes UUID-array multiselect storage impossible.

- Completed CAT-01C with same-transaction dictionary audit records, deduplicated
  `CategoryRenamed` search-rebuild outbox messages, rollback coverage, and
  authenticated historical resolution of archived categories and lifecycle
  statuses.

- Started CAT-01A with constrained category/lifecycle-status tables, immutable
  stable keys, bilingual labels, optimistic versions, acyclic category parents,
  idempotent lifecycle seeds, Prisma repositories, and PostgreSQL policy tests.

- Completed FND-05 with English source/fallback resources, complete initial Ukrainian coverage, explicit/stored locale resolution, non-automatic browser suggestions, public and authenticated selectors, persisted user preferences, locale-aware formatting and problem messages, and an MVP coverage gate.

- Completed FND-04C with hashed one-time invitations, the section 16 role/capability policy, last-Owner protection, authentication rate limits, secret-free security audit events, versioned user administration, generated API contracts, and English/Ukrainian browser flows for sign-in, invitations, users, roles, and sessions.

- Added the FND-04 Argon2id credential adapter with encoded work factors, random salts, fail-closed verification, real hashing tests and a PostgreSQL credential round-trip test.

- Started FND-04A with Kysely Auth/Audit tables, database constraints and indexes, append-only audit protection, and real-PostgreSQL upgrade/rollback and integrity tests. Scoped migration metadata to the current schema for parallel integration tests.

- Added and validated a Docker-only developer workflow with pinned Node/pnpm, API/Vue watchers, isolated dependency volumes, separate development/test PostgreSQL, Chromium and opt-in Docker tooling.

- Approved product design document.
- Approved implementation blueprint.
- Executable TODO roadmap.
- Initial repository documentation and agent working rules.
- Stage 0 reference fixtures, hardware and physical-label records, deferred-choice review, and ordered Stage 1 handoff.
- Completed the Stage 0 exit gate with a calibrated half-sheet A4 label proof and recorded physical test devices.
- Bootstrapped the pinned pnpm monorepo with API, worker, web, and shared package composition roots.
- Added stable root commands, JavaScript/TypeScript checks, unit and E2E smoke tests, module-boundary enforcement, and clean-checkout CI.
- Added the Vue application shell, approved route baseline, Vue Query/Pinia state boundaries, semantic tokens, and all 18 approved UI facade components.
- Added the FND-02 compact-deployment foundation with pinned multi-stage backend/web images, private PostgreSQL networking, ordered migration/API/Caddy startup, typed configuration, database-authoritative bootstrap settings, health/meta endpoints, operational profiles, and persistence drills.
- Added the FND-03 deterministic OpenAPI pipeline with shared checksums, generated TypeScript/JSDoc/Fetch/Zod contracts, CI drift detection, and a lint policy against handwritten frontend payload schemas.

## Planned

### [0.1.0] - Technical Demo

- Clean Docker Compose deployment.
- Database migrations and generated API contracts.
- Owner bootstrap, sign-in, roles, and session handling.
- English default and selectable Ukrainian localization foundation.
- Frontend application shell and semantic UI facade.

Release dates and comparison links are added only when a release is actually published.
