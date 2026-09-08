# AGENTS.md

## Purpose

This file defines the working contract for coding agents in the Inventory Atlas repository.

Inventory Atlas is a self-hosted inventory and storage-location system. It catalogs Items and configurable attributes, models nested containers, manages media, provides privacy-safe search, generates QR/Code 128 labels, and supports portable export/import.

## Source-of-truth order

When instructions conflict, stop and resolve the conflict in this order:

1. Approved product design document.
2. `IMPLEMENTATION-BLUEPRINT.md` and accepted ADRs.
3. `TODO-ROADMAP.md` story outcomes and verbatim acceptance criteria.
4. This file and other repository documentation.
5. Existing implementation conventions.

Do not change product scope, frozen architecture, an acceptance criterion, or an ADR decision merely to simplify implementation. Escalate the conflict instead.

## Technology baseline

### Frontend

- Vue 3 SFC and Composition API.
- Modern JavaScript with `checkJs`; do not convert the frontend to TypeScript without an approved ADR.
- Vite.
- Vue Query owns server state, caching, invalidation, cancellation, and mutation state.
- Pinia owns session summary, preferences, navigation, and local UI state only.
- PrimeVue may be imported only inside `packages/ui`; application code uses the semantic `App*` facade.
- English is the source/default locale. Ukrainian must be complete and selectable in the MVP.

### Backend

- Node.js 24 LTS.
- NestJS with TypeScript and the Fastify adapter.
- Modular monolith with explicit module public surfaces.
- REST under `/api/v1`; normalized OpenAPI is the contract source.
- Generated declarations/JSDoc types and Zod schemas must share one spec checksum.

### Data and infrastructure

- PostgreSQL is the only mandatory infrastructure dependency.
- Kysely is the sole schema migration authority. Do not run Prisma Migrate in deployment.
- Prisma handles approved CRUD ownership; Kysely handles specialized Storage, Search, Jobs, and SQL paths as defined by the blueprint.
- One business transaction uses exactly one client. Cross-owner writes use the supplied transaction-aware ports.
- Local media is the default; S3-compatible storage is optional.
- Docker Compose is the deployment baseline.
- Do not introduce Redis, a message broker, an external search engine, microservices, or mandatory S3 in the MVP.

### Testing

- Unit: Vitest/Jest.
- Integration: real PostgreSQL, never SQLite or an in-memory substitute for database behavior.
- API contract: Nest test application plus normalized OpenAPI checks.
- E2E and visual: Playwright.
- Physical label and recovery drills remain explicit release gates.

## Engineering principles

- Prefer KISS and clear module ownership over speculative abstraction.
- Apply SOLID and object-oriented design where behavior and boundaries justify it.
- Apply DRY to stable knowledge, not to coincidental similarity.
- Keep controllers thin; application services orchestrate; domain policies own business rules; adapters own vendor details.
- Do not create empty architectural layers.
- Preserve privacy by construction: private values must not enter lower-role projections, vectors, counts, logs, or metrics.
- Keep public IDs, scan tokens, and display names as separate concepts.
- Maintain optimistic concurrency and idempotency on every required mutation path.

## Task workflow

1. Read the relevant roadmap story, its dependencies, acceptance criteria, and applicable ADRs.
2. Select one unchecked task or one coherent suggested PR package.
3. Confirm required predecessor tasks are complete.
4. Implement the smallest complete vertical change.
5. Add or update unit, integration, contract, E2E, security, localization, and operational checks as applicable.
6. Run the narrow relevant checks, then the required root checks.
7. Update generated contracts, documentation, and tracking checkboxes only when the implementation evidence exists. When a completion item is represented by a checkbox in both `TODO-ROADMAP.md` and `IMPLEMENTATION-BLUEPRINT.md`, update both marks in the same change so their states remain identical. This includes duplicated acceptance criteria and bootstrap/adoption items. Preserve verbatim acceptance-criterion text, and do not turn normative blueprint lists into tracking checklists.
8. Review the diff for unrelated edits, secrets, private values, generated drift, and ownership violations.
9. Create a local commit only under the commit policy below.

## Git policy

### Local commits are authorized

An agent MAY create a local commit after one feature, roadmap task, or coherent PR package is fully implemented and verified.

A commit MUST:

- Leave the repository buildable and relevant tests passing.
- Include required migrations, generated contracts, localization, and documentation.
- Avoid unrelated user changes.
- Use a focused Conventional Commit message, for example `feat(storage): add atomic subtree move` or `fix(search): exclude private option values`.

Do not commit partial experiments, knowingly failing code, secrets, generated junk, or unrelated formatting churn. Do not rewrite, amend, squash, or delete commits created by the user unless explicitly instructed.

### Pushes are forbidden without permission

An agent MUST NOT run `git push`, force-push, publish a branch, create or merge a pull request, create/push a tag, or publish a release without the project owner's explicit permission for that action.

Permission to implement or commit is not permission to push. Ask before any remote mutation.

## Versioning

Inventory Atlas uses a SemVer-compatible pre-`1.0.0` policy:

- `0.1.0` is the first Technical Demo.
- A completed normal feature step increments the middle counter and resets patch: `0.1.0` -> `0.2.0`.
- Small fixes, documentation corrections, tests, safe refactors, and maintenance increment patch: `0.1.0` -> `0.1.1`.
- Pre-demo snapshots use `0.1.0-dev.N`; release candidates may use `X.Y.Z-rc.N`.
- `1.0.0` is reserved for the complete stable MVP after every MVP release gate passes.

Version changes must stay synchronized across root package metadata, `README.md`, `TODO-ROADMAP.md`, and `CHANGELOG.md`. Creating or pushing a version tag requires explicit owner permission.

See `docs/project/versioning.md` for the complete release procedure.

## Required checks

Use the root commands defined by the blueprint as they become available. Before a feature commit, run all checks relevant to the changed area. Before a release candidate, run the complete pipeline, including:

```bash
pnpm lint
pnpm check
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm db:verify
pnpm contracts:check
pnpm i18n:check
pnpm compose:validate
```

Never mark a roadmap checkbox complete solely because code exists. Required tests, contracts, localization, documentation, and applicable Definition of Done items must also pass.

## Safety and repository hygiene

- Preserve existing and unrelated worktree changes.
- Never use destructive Git commands unless the owner explicitly requests the exact operation.
- Never commit credentials, session tokens, scan keys, provider secrets, production URLs containing secrets, or private inventory data.
- Use fixtures with synthetic data only.
- Do not log private EAV values, raw tokens, passwords, full upload paths, or provider credentials.
- Do not bypass authorization with UI-only hiding.
- Do not mix Prisma and Kysely clients inside one business transaction.
- Do not edit generated files by hand when a generator owns them.
- Do not silently weaken a failing test, constraint, security rule, or acceptance criterion.
