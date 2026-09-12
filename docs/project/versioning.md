# Versioning

Inventory Atlas uses Semantic Versioning with an explicit pre-`1.0.0` feature policy.

## Version format

```text
MAJOR.MINOR.PATCH[-PRERELEASE]
```

## Before 1.0.0

| Change | Version action | Example |
| --- | --- | --- |
| Pre-release work before the first normal release | Aggregate verified work packages under `0.1.0-dev.N` | `0.1.0-dev.1` -> `0.1.0-dev.2` |
| First Usable Validation Release | Start normal releases at `0.1.0` after its complete gate passes | `0.1.0` |
| Completed normal feature step after `0.1.0` | Increment `MINOR`, reset `PATCH` | `0.1.3` -> `0.2.0` |
| Small bug fix, documentation correction, test improvement, safe refactor, or maintenance update | Increment `PATCH` | `0.2.0` -> `0.2.1` |
| Development snapshot before a planned release | Add/increment `dev.N` | `0.1.0-dev.1` |
| Release candidate | Add/increment `rc.N` | `0.3.0-rc.1` |

Multiple pre-release work packages may accumulate in `0.1.0-dev.N`; their completion does not consume `0.2.0`, `0.3.0`, or later normal versions before the first release. Optional convenience QR delivered before the `0.1.0` cut may be included in that release. If delivered afterward, it is a normal feature increment.

Do not use a patch release to introduce a normal user-facing feature. After `0.1.0`, do not increment the minor version for an incomplete feature hidden only by convention; the planned outcome and its required gates must be complete.

## Planned milestones

| Version | Milestone |
| --- | --- |
| `0.1.0-dev.N` | Pre-release snapshots aggregating Implemented Foundation, Catalog/Media, Storage, Lean Search, recovery, and validation work |
| `0.1.0` | Usable Validation Release: safe end-to-end inventory loop, operational restore, and seven-day dogfooding gate |
| `0.2.0+` | Normal post-validation feature increments selected after evidence-driven revalidation; exact assignment is made when each coherent feature step is approved |
| `1.0.0` | Production Baseline after revalidated Search richness, Labels/Scanner, portable interchange, scale, and complete production release gates pass |

Milestone versions are planning targets. The roadmap does not pre-allocate `0.2.0`, `0.3.0`, and later numbers to work already bundled into `0.1.0`. A scope change requires an approved blueprint/roadmap update; it must not be hidden by changing only the version table.

## After 1.0.0

- `MAJOR`: incompatible public API, persistence, deployment, or product-contract change with an approved migration plan.
- `MINOR`: backward-compatible feature.
- `PATCH`: backward-compatible fix or maintenance update.

## Release synchronization

A release pull request updates all applicable version sources together:

- Root package/workspace metadata.
- [README](../../README.md) current/target version.
- [Roadmap](../../TODO-ROADMAP.md) stage/version state.
- [Changelog](../../CHANGELOG.md) release section and date.
- Generated API/build metadata exposed through `/api/v1/meta`.
- Container image labels and release artifacts.

Version tags use `vMAJOR.MINOR.PATCH`, for example `v0.1.0`.

## Release procedure

1. Confirm the target release-horizon gate, owned story outcomes, and applicable Definition of Done items pass.
2. Run the complete required test, contract, localization, migration, build, container, security, and recovery checks.
3. Update every version source and changelog in one release pull request.
4. Create a local release commit only after verification.
5. Obtain explicit project-owner permission before pushing, creating a tag, publishing a release, or merging remotely.
6. Record release artifacts, checksums, migration notes, and backup compatibility notes.
