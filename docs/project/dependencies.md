# Initial dependency and license baseline

These are the exact direct dependency versions selected for the first workspace
bootstrap. FND-01 may omit a package until its owning capability is introduced,
but must use the recorded version when it first adds that package. Any change
must follow the update policy in [toolchain.md](toolchain.md).

Versions and package metadata were checked against the npm registry on
2026-09-04. Exact pins and the generated lockfile, not this table alone, will be
the install authority.

## Frontend runtime

| Package | Version | License | Purpose |
| --- | ---: | --- | --- |
| `vue` | `3.5.42` | MIT | Vue SFC runtime |
| `vue-router` | `5.3.1` | MIT | Application routes |
| `pinia` | `4.0.3` | MIT | Session/preferences/navigation/local UI state |
| `@vue/devtools-api` | `8.2.1` | MIT | Required Pinia peer |
| `@tanstack/vue-query` | `5.102.8` | MIT | Server state and mutations |
| `vue-i18n` | `11.4.10` | MIT | English/Ukrainian localization |
| `primevue` | `4.4.1` | MIT | UI adapter implementation only |
| `@primeuix/themes` | `1.2.5` | MIT | PrimeVue theme primitives behind semantic tokens |
| `zod` | `4.5.4` | MIT | Generated runtime contract validation |

## Backend runtime and data access

| Package | Version | License | Purpose |
| --- | ---: | --- | --- |
| `@nestjs/common` | `12.0.1` | MIT | NestJS framework |
| `@nestjs/core` | `12.0.1` | MIT | NestJS framework core |
| `@nestjs/platform-fastify` | `12.0.1` | MIT | Fastify adapter |
| `@nestjs/swagger` | `12.0.1` | MIT | OpenAPI source generation |
| `@nestjs/config` | `12.0.0` | MIT | Typed configuration integration |
| `fastify` | `5.12.3` | MIT | HTTP server |
| `@fastify/static` | `10.1.3` | MIT | Swagger/static support required by the adapter stack |
| `@prisma/client` | `7.10.0` | Apache-2.0 | Approved CRUD client |
| `@prisma/adapter-pg` | `7.10.0` | Apache-2.0 | PostgreSQL driver adapter for Prisma 7 |
| `kysely` | `0.29.5` | MIT | Migrations and specialized SQL paths |
| `pg` | `8.23.0` | MIT | PostgreSQL driver |
| `argon2` | `0.45.1` | MIT | Argon2id password hashing |
| `rxjs` | `7.8.2` | Apache-2.0 | NestJS peer/runtime dependency |
| `reflect-metadata` | `0.2.2` | Apache-2.0 | NestJS metadata support |
| `class-transformer` | `0.5.1` | MIT | DTO transformation |
| `class-validator` | `0.15.1` | MIT | Backend DTO validation |

## Build, checks, tests, and contract generation

| Package | Version | License | Purpose |
| --- | ---: | --- | --- |
| `vite` | `8.2.2` | MIT | Frontend build and development server |
| `@vitejs/plugin-vue` | `6.0.8` | MIT | Vue SFC integration |
| `@vue/compiler-sfc` | `3.5.42` | MIT | Vue SFC compiler matched to Vue |
| `typescript` | `6.0.3` | Apache-2.0 | Backend types and frontend `checkJs` |
| `@types/node` | `24.13.3` | MIT | Node.js 24 declarations |
| `@types/pg` | `8.15.6` | MIT | PostgreSQL driver declarations |
| `eslint` | `10.10.0` | MIT | Lint runner |
| `@eslint/js` | `10.0.1` | MIT | ESLint JavaScript rules |
| `typescript-eslint` | `8.69.0` | MIT | TypeScript-aware linting |
| `eslint-plugin-vue` | `10.10.0` | MIT | Vue SFC linting |
| `vue-eslint-parser` | `10.4.1` | MIT | Explicit Vue lint parser peer |
| `prettier` | `3.9.6` | MIT | Formatting |
| `vitest` | `5.0.0` | MIT | Unit and component tests |
| `@vitest/coverage-v8` | `5.0.0` | MIT | Unit-test coverage |
| `jsdom` | `30.0.1` | MIT | Component-test DOM |
| `@nestjs/testing` | `12.0.1` | MIT | Nest test applications and modules |
| `@playwright/test` | `1.62.1` | Apache-2.0 | E2E, visual, and browser contract tests |
| `testcontainers` | `12.1.0` | MIT | Real PostgreSQL integration tests |
| `@hey-api/openapi-ts` | `0.99.0` | MIT | Generated operations/types/Zod inputs |
| `vue-tsc` | `3.3.11` | MIT | Vue SFC-aware JavaScript `checkJs` validation |
| `@vue/test-utils` | `2.4.6` | MIT | Vue component smoke and interaction tests |
| `tsx` | `4.21.0` | MIT | Local NestJS TypeScript entrypoint runner |
| `globals` | `16.5.0` | MIT | ESLint runtime global definitions |

TypeScript 6.0.3 is intentionally selected instead of the newer 7.x line:
`typescript-eslint` 8.69.0 supports TypeScript below 6.1, while the selected
contract generator supports TypeScript 6. This is a verified common range.
Prisma CLI and client must remain on the same stable version, `7.10.0`; the
newer Prisma prerelease is not part of the baseline.

The runtime uses `@prisma/client` and `@prisma/adapter-pg` 7.10.0. The Prisma
CLI is temporarily absent from the installed workspace because its current
transitive Studio dependency includes EPL-2.0 and fails the repository license
gate. The generated 7.10.0 client is committed, so clean builds remain
reproducible; regenerating it is blocked pending the required license review.

FND-04 installs the approved `argon2` 0.45.1 runtime dependency and explicitly
allows its native-binding install script. The credential adapter and validation
scope are documented in [authentication.md](authentication.md).

## Infrastructure license

| Component | Version | License |
| --- | ---: | --- |
| Node.js | `24.20.0` | MIT and bundled third-party notices |
| Corepack | `0.36.0` | MIT |
| pnpm | `11.25.0` | MIT |
| PostgreSQL | `18.6` | PostgreSQL License |

## Compatibility conclusion and limits

The selected direct baseline uses permissive MIT, Apache-2.0, and PostgreSQL
licenses. These licenses are compatible with private self-hosting and with
distribution of Inventory Atlas when their copyright, license, and notice
conditions are retained. PrimeVue 4.4.1 and PrimeUIX Themes 1.2.5 package
metadata and bundled license files were verified as MIT. The originally
recorded 5.0.1/3.0.0 versions were corrected during FND-01 because those
releases changed to a conditional commercial/community license, contrary to
this project's dependency policy. Vite's transitive Lightning CSS packages use
MPL-2.0. They are build tooling; Inventory Atlas does not modify or redistribute
their source, and their file-level copyleft does not apply to generated
application bundles. MPL-2.0 is therefore included in the automated allowlist
with this explicit review.

This is an engineering compatibility review, not legal advice. It does not yet
approve optional media codecs or providers. In particular, the HEIC/libheif
image distribution review required by ADR-011 remains a separate release gate.
FND-01 must generate a complete transitive license report from the committed
lockfile; CI/release must fail on missing, unknown, non-commercial, or denied
licenses until reviewed.

Primary metadata sources:

- [npm registry](https://registry.npmjs.org/)
- [PrimeVue MIT license](https://github.com/primefaces/primevue/blob/master/LICENSE.md)
- [PrimeUIX MIT license](https://github.com/primefaces/primeuix/blob/main/LICENSE)
- [PostgreSQL license](https://www.postgresql.org/about/licence/)
