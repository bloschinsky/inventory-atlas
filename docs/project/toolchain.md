# Toolchain baseline

This baseline was selected on 2026-09-04 for Stage 0 and is binding for the
initial repository bootstrap. FND-01 must encode these values in repository
metadata and the lockfile rather than selecting versions again.

## Pinned runtime and infrastructure

| Component | Exact version | Pin location planned for FND-01/FND-02 |
| --- | ---: | --- |
| Node.js LTS (`Krypton`) | `24.20.0` | `engines.node`, `.node-version`, CI, and container image |
| Corepack | `0.36.0` | bootstrap command and CI setup |
| pnpm | `11.25.0` | `packageManager` and lockfile |
| PostgreSQL | `18.6` | Compose image and CI integration database |

Node.js 24 remains the frozen runtime major from the approved blueprint. The
selected Corepack and pnpm releases support Node.js 24.20.0. PostgreSQL 18.6 is
the current supported release in the current major and provides the extensions
required by schema v1.

Sources checked on 2026-09-04:

- [Node.js release index](https://nodejs.org/dist/index.json)
- [Corepack package metadata](https://www.npmjs.com/package/corepack/v/0.36.0)
- [pnpm package metadata](https://www.npmjs.com/package/pnpm/v/11.25.0)
- [PostgreSQL version policy and current releases](https://www.postgresql.org/support/versioning/)

## Bootstrap contract

- FND-01 must use exact versions, without `^`, `~`, `latest`, or floating
  container tags.
- `corepack enable` alone is not a version pin. Bootstrap must install and use
  Corepack 0.36.0, then activate pnpm 11.25.0 from the root `packageManager`
  declaration.
- The committed `pnpm-lock.yaml` is the authority for transitive JavaScript
  dependency versions.
- Production and CI container images must use an immutable digest in addition
  to the human-readable version tag.
- A clean setup must fail early with a clear version mismatch instead of
  continuing on an unsupported local toolchain.

## Update policy

The FND-04 maintenance update pins `tsx` 4.23.13 for esbuild 0.28.1, restores
Prisma CLI 7.10.0 with its reviewed development-only dependencies, and applies
narrow security overrides. See [dependency remediation](dependency-remediation.md).

- Review runtime, package, browser, and PostgreSQL security advisories weekly;
  triage critical/high findings within two working days.
- Review dependency updates monthly. Update a coherent compatibility group
  together (Vue, NestJS, Prisma, Vitest, or ESLint), regenerate the lockfile and
  contracts, and run all checks owned by that group.
- Accept Node.js 24 patch releases after the normal pipeline and container smoke
  tests pass. Changing the Node.js major conflicts with the frozen baseline and
  requires an approved ADR/blueprint update.
- Apply supported PostgreSQL minor releases after migration, integration,
  backup, and disposable restore checks. A PostgreSQL major upgrade requires a
  documented upgrade/rollback plan and the complete database release gates.
- Major dependency upgrades are deliberate work items. They are never
  auto-merged and must include migration notes when APIs, generated output, or
  persisted data can change.
- Every dependency change reruns license and vulnerability checks. New
  copyleft, source-available, non-commercial, or unclear terms block the update
  pending owner/legal review.
- Update this file, the dependency baseline, browser snapshot, lockfile, CI, and
  container pins in the same coherent change whenever their recorded versions
change.
