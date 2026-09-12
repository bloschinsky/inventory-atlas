# Inventory Atlas Documentation Follow-up Fixes

> Baseline: `34d45eac9b00ee8c7c48eae449c388d7531868ee`
>
> Scope: documentation only
>
> Applied in Blueprint/Roadmap v0.3.1; retained here as project decision context.

## Objective

Remove the remaining ambiguity from Blueprint v0.3 and Roadmap v0.3 before implementing SRCH-01/SRCH-02. Preserve the approved release horizons, existing architecture, story IDs, acceptance criteria, and completed work.

## 1. Fix `FieldDefinitionChanged` privacy semantics

The current invalidation table describes `FieldDefinitionChanged` as an asynchronous outbox/rebuild path, while the `0.1.0` privacy contract requires synchronous removal of values from public projections when field visibility or searchability becomes more restrictive.

Update `IMPLEMENTATION-BLUEPRINT.md` and `TODO-ROADMAP.md` to define:

- ordinary label/schema changes may use the documented asynchronous rebuild;
- reducing `public_visibility`, disabling public searchability/filterability, or otherwise making a field more restrictive MUST synchronously remove the affected values from `public_attrs`, `public_search_vector`, derived public tokens, facets, and counts before commit;
- the transaction may conservatively clear affected public projection content and mark rows `stale`; an idempotent job may rebuild safe content afterward;
- no background-job delay may expose a value that has become private;
- failure of the synchronous privacy update rolls back the field-definition mutation and its outbox record.

Add or retain a blocking `0.1.0` integration-test requirement proving that immediately after commit:

- Viewer and Editor cannot find or confirm the removed value through hits, filters, facets, or counts;
- retry/restart rebuilds only restore values currently permitted by the updated definition.

## 2. Split SRCH-02 tasks by delivery horizon

The SRCH-02 explanatory paragraph distinguishes validation scope from production scope, but the task checklist still mixes both horizons.

Prefix or group every SRCH-02 task explicitly as one of:

- **`0.1.0 blocking`**;
- **`Post-validation / revalidation required`**.

At minimum, mark these as `0.1.0 blocking`:

- authenticated text search over permitted content;
- category, lifecycle-status, and storage-location filters;
- filter types actually exposed by the `0.1.0` API/UI;
- stable bounded cursor pagination;
- current permitted location in results;
- role-safe query construction;
- English/Ukrainian search and UI states;
- API, authorization, privacy, cursor, and relevant PostgreSQL integration tests.

Mark these as post-validation unless separately approved for `0.1.0`:

- complete generic typed-filter breadth;
- advanced relevance tuning and full relevance UI;
- 100,000-Item dataset and performance certification;
- UI or sorting capabilities not required by the shipped Lean Search contract.

Do not mark SRCH-02 fully complete when only its `0.1.0` subset is delivered. Add separate subset completion/exit tracking while retaining the original production acceptance criteria verbatim.

## 3. Clarify release-pipeline horizons

In the Blueprint and Roadmap release/CI sections, state explicitly:

- checks required for shipped `0.1.0` behavior remain mandatory;
- SBOM, complete release-artifact set, previous-version upgrade matrix, physical label certification, portable round trip, and other production-only gates block `1.0.0`, not `0.1.0`, unless already automated and explicitly adopted earlier;
- the horizon-specific release checklists are authoritative when a generic release-pipeline item is broader.

## 4. Replace ambiguous standalone “MVP” wording

Review modified planning and agent documents. Where `MVP` could refer to either release horizon, replace it with the exact term:

- `0.1.0 Usable Validation Release`; or
- `1.0.0 Production Baseline`.

Historical identifiers such as `MVP-S1`, filenames, and quoted legacy acceptance text may remain unchanged.

## Validation

Before completion, verify:

- Blueprint is updated before Roadmap and both express identical invalidation semantics;
- no restrictive field-definition change can rely only on asynchronous cleanup;
- every SRCH-02 task has an explicit delivery horizon;
- QR remains non-blocking for `0.1.0`;
- all eight invalidator paths remain required for `0.1.0`;
- Storage integrity tests and Search privacy tests remain blocking;
- original story IDs and production acceptance criteria remain traceable;
- no completed implementation status is reverted;
- no code, migration, generated artifact, dependency, or runtime configuration changes;
- `git diff --check` and relevant documentation/link checks pass.

Return the changed-file list, a short mapping of corrected sections, and the validation results. Do not push, tag, release, or open a pull request without separate owner authorization.
