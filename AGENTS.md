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

## Repository map

Keep this section current. Any change that adds, removes, moves, renames, or materially repurposes a project directory or package must update this map in the same change.

| Path | Purpose |
| --- | --- |
| `apps/api` | NestJS/Fastify HTTP composition root: controllers, API DTOs/OpenAPI decorators, and runtime wiring. Domain and repository logic belongs in `packages/backend`. |
| `apps/web` | Vue application. `app/` owns bootstrapping, routing, layouts, and UI stores; `pages/` composes routes; `features/` owns user workflows; `entities/` owns reusable domain presentation; `shared/` owns generic API, auth, i18n, UI, and utility code. Playwright specs live in `e2e/`. |
| `apps/worker` | NestJS background-worker composition root for the expanded profile. It starts the same backend media and job runtime the API composes in compact mode, without owning domain logic. |
| `packages/backend` | Backend domain, application services, ports, and data adapters, grouped by module under `src/` (`auth`, `catalog`, `schema`, `media`, `jobs`, and shared `infrastructure`), with `runtime.ts` assembling the media and job runtime both composition roots share. Other workspaces import only its public `src/index.ts` surface. |
| `packages/config` | Shared environment parsing, validation, and runtime configuration types. |
| `packages/contracts` | OpenAPI-generated types, Fetch client, JSDoc declarations, and Zod schemas. Files under `src/generated/` are generator-owned. |
| `packages/i18n` | Locale setup, the MVP message inventory, and English/Ukrainian translations. |
| `packages/ui` | Semantic `App*` component facade, PrimeVue integration, and design tokens. |
| `packages/testkit` | Shared synthetic test helpers and fixtures intended for reuse across workspaces. |
| `db/migrations` | Ordered Kysely migrations; the sole schema-migration authority. |
| `db/prisma` | Prisma CRUD schema. Generated Prisma code lives in `packages/backend/src/generated/prisma/` and must not be edited manually. |
| `db/seeds` / `db/fixtures` | Seed guidance and versioned catalog, storage, media, and label acceptance fixtures. |
| `docs/adr` | Accepted architecture decisions. `docs/project`, `docs/frontend`, `docs/operations`, `docs/api`, and `docs/security` contain focused implementation and operating guidance. |
| `infra` | Production/development container images, Compose overlays, and Caddy configuration. Root `docker-compose.yml` is the compact deployment graph; `compose.dev.yml` is the daily development environment. |
| `scripts` | Root generators and policy checks for contracts, boundaries, i18n, licenses, Compose, Prisma, and repository hygiene. |
| `.github/workflows` | CI workflow definitions. Root config files define the pnpm workspace and shared TypeScript, JavaScript, lint, Vitest, and Playwright behavior. |

### Where to make a change

- Start product work from the matching story in `TODO-ROADMAP.md`, then follow its blueprint sections and ADRs.
- For an API change, update HTTP contracts/controllers in `apps/api`, implement behavior through the public modules in `packages/backend`, then regenerate `docs/api/openapi.json` and `packages/contracts/src/generated/`.
- When `apps/api` or `apps/worker` gain a runtime import from a workspace package, add that package to the `runtime-dependencies` and `runtime` stages of `infra/docker/backend.Dockerfile` and give its `exports` entry a built `default` condition. A `.ts` entry resolves only under the `development` condition, so a package that works in tests and `pnpm dev` can still break the deployed image.
- For a frontend workflow, compose the route in `apps/web/src/pages`, place use-case behavior in `features`, and reuse `shared/ui` rather than importing PrimeVue directly.
- Keep unit tests beside their source as `*.test.*`, PostgreSQL tests as `*.integration.test.*`, and browser journeys in `apps/web/e2e`.
- Treat `dist/`, `node_modules/`, `.pnpm-store/`, `test-results/`, and generated source directories as outputs, not implementation entry points.

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
- Recovery is a `0.1.0` release gate; the physical label matrix gates the `1.0.0 Production Baseline` when LAB stories are revalidated and shipped.

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
8. If an audit cannot confirm a status, mark it `unverified` and refer it to the owner; do not infer `not implemented` from missing evidence. Removing an existing completion checkbox requires separate owner confirmation before the documentation diff is merged.
9. Review the diff for unrelated edits, secrets, private values, generated drift, and ownership violations.
10. Create a local commit only under the commit policy below.

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

- `0.1.0-dev.N` may aggregate multiple pre-release work packages before the first normal release.
- `0.1.0` is the first Usable Validation Release: the complete safe inventory loop defined by blueprint v0.3.
- After `0.1.0`, a completed normal feature step increments the middle counter and resets patch: `0.1.0` -> `0.2.0`.
- Small fixes, documentation corrections, tests, safe refactors, and maintenance increment patch: `0.1.0` -> `0.1.1`.
- Release candidates may use `X.Y.Z-rc.N`.
- `1.0.0` is reserved for the complete Production Baseline after every production gate passes.

Version changes must stay synchronized across root package metadata, `README.md`, `TODO-ROADMAP.md`, and `CHANGELOG.md`. Creating or pushing a version tag requires explicit owner permission.

See `docs/project/versioning.md` for the complete release procedure.

## Required checks

The root scripts in `package.json` are the authoritative command list; read them instead of assuming a command name. The supported way to execute them is inside the Docker tools container described in `docs/operations/development.md`. The `pnpm <script>` forms below name the script, not the host invocation.

`pnpm check` is an aggregate. It already runs `check:types`, `boundaries:check`, `contracts:check`, `ui:facade-gaps`, and `clean-checkout:check`, so do not run or list those members as separate gates.

`pnpm prisma:check` validates and generates the schema with the pinned CLI in isolation, so `pnpm prisma:validate` is not a separate gate either.

Before a feature commit, run all checks relevant to the changed area.

Before a release candidate, run the complete pipeline:

```bash
pnpm format:check
pnpm license:check
pnpm security:check
pnpm prisma:check
pnpm lint
pnpm check
pnpm test
pnpm test:integration
pnpm build
pnpm db:verify
pnpm i18n:check
pnpm test:e2e
pnpm compose:validate
pnpm test:compose:persistence
```

`db:verify` and `test:integration` require a reachable PostgreSQL instance with migrations applied. The compose checks run in the `docker-tools` service, not `tools`.

`.github/workflows/ci.yml` enforces only part of this pipeline: `license:check`, `security:check`, `prisma:check`, `lint`, `check`, `test`, `test:integration`, `build`, and the runtime smoke image. A green CI run is therefore not evidence that `format:check`, `db:verify`, `i18n:check`, `test:e2e`, `compose:validate`, or `test:compose:persistence` passed; run those locally before a release candidate.

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
