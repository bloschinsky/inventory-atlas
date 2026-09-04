# Versioning

Inventory Atlas uses Semantic Versioning with an explicit pre-`1.0.0` feature policy.

## Version format

```text
MAJOR.MINOR.PATCH[-PRERELEASE]
```

## Before 1.0.0

| Change | Version action | Example |
| --- | --- | --- |
| First Technical Demo | Start normal releases at `0.1.0` | `0.1.0` |
| Completed normal feature step or delivery stage | Increment `MINOR`, reset `PATCH` | `0.1.3` -> `0.2.0` |
| Small bug fix, documentation correction, test improvement, safe refactor, or maintenance update | Increment `PATCH` | `0.2.0` -> `0.2.1` |
| Development snapshot before a planned release | Add/increment `dev.N` | `0.1.0-dev.1` |
| Release candidate | Add/increment `rc.N` | `0.3.0-rc.1` |

Do not use a patch release to introduce a normal user-facing feature. Do not increment the minor version for an incomplete feature hidden only by convention; the planned outcome and its required gates must be complete.

## Planned milestones

| Version | Milestone |
| --- | --- |
| `0.1.0-dev.N` | Discovery and Foundation snapshots |
| `0.1.0` | First Technical Demo: clean deployment, migrations, sign-in, generated contracts, and localization foundation |
| `0.2.0` | Core catalog, dynamic schema, display names, and media |
| `0.3.0` | Nested storage tree, atomic moves, breadcrumbs, and history |
| `0.4.0` | Privacy-safe search, filters, saved views, and bulk actions |
| `0.5.0` | Stable QR/Code 128 labels, printable batches, and mobile scan |
| `0.6.0` | Portable export/import and operational restore candidate |
| `1.0.0` | Complete stable MVP after every release checklist gate passes |

Milestone versions are planning targets. A scope change requires an approved blueprint/roadmap update; it must not be hidden by changing only the version table.

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

1. Confirm the target story/stage exit gate and applicable Definition of Done items pass.
2. Run the complete required test, contract, localization, migration, build, container, security, and recovery checks.
3. Update every version source and changelog in one release pull request.
4. Create a local release commit only after verification.
5. Obtain explicit project-owner permission before pushing, creating a tag, publishing a release, or merging remotely.
6. Record release artifacts, checksums, migration notes, and backup compatibility notes.
