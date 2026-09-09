# Changelog

All notable changes to Inventory Atlas will be documented in this file.

The project follows the version policy in `docs/project/versioning.md`.

## [Unreleased]

### Changed

- Approved the exact development-only Prisma Studio/elkjs license exception and restored Prisma CLI tooling. Patched YAML/esbuild and newly introduced CLI dependency advisories, added CI security/license/tooling gates, and separated backend production dependencies from build tooling with an image-content check.

### Added

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
