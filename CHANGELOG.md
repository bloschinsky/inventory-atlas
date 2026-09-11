# Changelog

All notable changes to Inventory Atlas will be documented in this file.

The project follows the version policy in `docs/project/versioning.md`.

## [Unreleased]

### Fixed

- Repaired the compact runtime image, which could not start since the Item and media controllers
  began validating request bodies with the generated Zod schemas: `@inventory-atlas/contracts`
  was missing from the production dependency stage, and its `./zod` entry resolved to a
  TypeScript source file that Node cannot load. The package now exposes a built default entry
  beside the development/type conditions, and the backend image builds and installs it with the
  rest of the runtime graph. The CI runtime-smoke image check and the Compose persistence drill
  cover this again.

### Changed

- Aligned the Stage-0 catalog fixture with approved schema vocabulary: `integer`
  and `decimal` became `number` with `validation.integer`, `publicVisibility`
  became three-value `visibility`, `unit` became plain text, the category list
  became one optional `appliesToCategory`, ordering moved from `position` to
  `displayOrder`, and the lifecycle statuses now mirror the seeded keys.

- Approved the exact development-only Prisma Studio/elkjs license exception and restored Prisma CLI tooling. Patched YAML/esbuild and newly introduced CLI dependency advisories, added CI security/license/tooling gates, and separated backend production dependencies from build tooling with an image-content check.

### Added

- Completed MED-02 and closed Stage 2 with isolated image processing and the background job
  foundation it needs. Kysely migration `0008_jobs` adds the Kysely-only queue: versioned
  payloads, priority, attempt budget, `available_at`/`leased_until`/`heartbeat_at`, worker ID, a
  unique idempotency key, bounded progress and last-error fields, guarded by check constraints so
  only a running job holds a worker, a lease and a heartbeat. Claiming is a short transaction
  using `for update skip locked`; work runs outside it under a heartbeat-extended lease; an
  expired lease returns to retry or dead state; backoff is exponential with jitter and a per-type
  maximum; and re-enqueueing one key wakes a waiting job instead of creating a second. The outbox
  dispatcher turns the `media.process-asset.v1` message MED-01 commits into that job and marks the
  message published in the same Kysely transaction. Decoding never happens in the API or worker
  process: `ImageProcessorPort` launches one short-lived `vipsheader`/`vips thumbnail` child per
  operation through a `ulimit` wrapper that caps address space, CPU time and core dumps, with the
  input-byte ceiling checked before launch, the decoded-pixel ceiling checked from the header, a
  wall-clock kill on top of the CPU limit and `VIPS_CONCURRENCY=1`. A crash, an OOM kill or a
  timeout reaches the caller as a classified value and becomes a retry and then a dead job, while
  an undecodable image is permanent and marks the asset `failed` with a stable code. Processed
  assets gain `thumb`/`card`/`preview` WebP renditions under deterministic keys, so reprocessing
  is idempotent; EXIF, XMP, IPTC and any GPS tag are removed from the produced container bytes
  (the pinned libvips ignores its own `strip` option for WebP) while EXIF orientation is applied
  to the pixels and dropped; variants inherit their source's authorization, so a private image
  cannot be read through its thumbnail; and only a `ready` asset advertises renditions. Both
  composition roots decode the four committed fixtures at startup and report `mediaCapabilities`
  through `/health/ready`, and the API claims jobs only in compact mode while the worker container
  claims only in the expanded profile, from one shared runtime factory.

- Completed MED-01 with the shared media model and the full Item image flow. Kysely migration
  `0007_media` adds Prisma-owned `media_assets`, `media_relations` and `upload_sessions` with
  partial unique indexes that enforce one active primary per owner and one active relation per
  owner, role and position. Uploading is three steps: an authorized session declares the file
  (approved types only, extension and declared type must agree, filename reduced to a safe base
  name, byte ceiling from `MEDIA_MAX_UPLOAD_BYTES`), a raw `PUT` streams the bytes into temporary
  storage while the size and SHA-256 are computed and the ceiling is enforced mid-stream, and
  finalize verifies size, checksum and file signature before promoting the object and writing the
  asset, relation, session completion, audit event and `media.process-asset.v1` message in one
  Prisma transaction. `MediaStoragePort` keeps bytes behind one contract with a local default
  driver that refuses keys outside its root, leaving S3 optional. Detaching only schedules
  deletion; `collectOrphans` rechecks live references and deletes conditionally, so a re-attached
  asset is retained. The Item edit page gained an accessible manager with upload progress, primary
  selection, gallery reordering and localized error codes, and the Item card now shows the primary
  image with the category placeholder as its fallback.

- Completed CAT-05 with safe display-name templates. `categories.display_template`
  now uses a closed `{{token}}` grammar with no loop, expression, JavaScript, or
  HTML surface: literal text is character-restricted, token names must be stable
  keys, and a template is capped at 12 tokens and 500 characters. Tokens resolve
  to the `category` and `status` core labels or to an active non-private
  item-scoped field; `private`, `boolean`, and `reference` fields are refused so
  a rendered name can never disclose a private value or an opaque identifier.
  One pure renderer skips missing tokens, drops the separators they orphan,
  collapses whitespace, and truncates deterministically. `items.display_name` is
  derived from it inside the Item transaction and rebuilt whenever a referenced
  value changes, while `public_id`, an existing slug, and issued codes stay
  untouched; a category template change enqueues the category rebuild message.
  `POST /api/v1/categories/{id}/display-name-preview` renders a candidate with
  the same renderer, and the `/admin/categories` editor inserts tokens, reports
  stable issue codes in the active locale, and previews English and Ukrainian
  output live.

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
