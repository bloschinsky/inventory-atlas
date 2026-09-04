# Contributing

Inventory Atlas is developed from an approved design, implementation blueprint, and executable roadmap. Contributions must preserve those decisions.

## Before starting

1. Read `IMPLEMENTATION-BLUEPRINT.md`, the relevant ADRs, and the selected `TODO-ROADMAP.md` story.
2. Confirm dependencies are complete and the task is not already in progress.
3. Keep the change within one story or coherent suggested PR package.
4. Discuss any product-scope, acceptance-criterion, module-boundary, public-API, or persistence-contract change before implementation.

## Development rules

- Keep controllers thin and business rules in the appropriate application/domain layer.
- Respect table ownership and transaction-aware ports.
- Use Kysely migrations; do not add a Prisma deployment migration stream.
- Do not import PrimeVue outside `packages/ui`.
- Use Vue Query for server state and Pinia only for approved client state.
- Generate frontend types and Zod schemas from normalized OpenAPI.
- Add English source text and complete Ukrainian translation for changed MVP UI.
- Test authorization and visibility separately, including negative cases.
- Use real PostgreSQL for database integration behavior.
- Never include real private inventory data or secrets in fixtures.

## Pull-request scope

A pull request should be independently reviewable and leave the project in a buildable state. Include:

- The implementation and required forward migration.
- Unit/integration/contract/E2E tests as applicable.
- Generated contracts and checksums when the API changes.
- Localization and accessibility work for UI changes.
- Operational/configuration documentation.
- Updated roadmap checkboxes only for work that is fully verified.

Acceptance criteria copied from the blueprint are immutable. Propose requirement changes in the blueprint first.

## Checks

Run the checks relevant to the change, then the required root checks available for the current stage:

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

## Commits and remote actions

Use focused Conventional Commit messages such as:

```text
feat(catalog): create typed item aggregate
fix(storage): serialize cross-root moves
docs(roadmap): record completed media gate
```

Coding agents may create a local commit only after a complete feature/task is implemented and verified. They may not push, create or merge a pull request, create a tag, or publish a release without explicit permission from the project owner.

## Versioning

Follow `docs/project/versioning.md`. Feature steps increment the middle number before `1.0.0`; small fixes increment the patch number. Keep the root package, README, roadmap, changelog, build metadata, and release artifacts synchronized.
