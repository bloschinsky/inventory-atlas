# Inventory Atlas: MVP Scope and Sequencing Revision

> Implementation record: applied to blueprint v0.3 and roadmap v0.3 on 2026-09-12; see [the audit and checkbox delta](mvp-scope-simplification-audit.md).

> Change request version: 2.0
>
> Repository baseline: `fe818ff0a2bcc307d873a960bab24b03de8bbd6a` (`master`, 2026-09-11)
>
> Primary targets: `IMPLEMENTATION-BLUEPRINT.md`, then `TODO-ROADMAP.md`

## 1. Objective

Revise the project documentation so Inventory Atlas can reach a usable validation release before the complete production baseline is finished.

This is a **scope and sequencing change**, not an architecture rewrite. Preserve completed work and keep designed advanced solutions documented for later revalidation. The revised plan must never trade tree integrity, transactional correctness, search privacy, or recoverability for schedule reduction.

Use this product hypothesis as the release filter:

> A user can create an Item, describe it with configurable fields and photos, place it in an arbitrarily nested storage location, later find it quickly, see exactly where it is, and recover the installation without losing the inventory.

## 2. Mandatory order of work

### Step 1 — inspect implementation and report the delta

Before editing either planning document, inspect the current branch and classify each relevant roadmap item as:

- **verified complete** — implementation and required evidence exist;
- **partially complete** — only part of the stated task exists;
- **not implemented**;
- **roadmap mismatch** — checkbox/status conflicts with the code or with another roadmap section.

Do not copy status claims from this brief as facts. At minimum, inspect migrations, services, ports, tests, API/UI surfaces, root scripts, CI, and operational documentation for:

- database/transaction infrastructure;
- jobs and outbox;
- `item_search` and projection writes;
- Stage 2 completion;
- the conditional CAT-03 destination-path task;
- Storage, Search, Labels, and Portability implementation.

Produce a short audit table before the documentation diff. Resolve verified checkbox drift in the planning documents and list every correction in the handoff.

The current roadmap contains known inconsistencies: cross-cutting database/job sections are unchecked despite completed flows depending on parts of them, while Stage 2 is marked complete even though CAT-03 still contains a destination-path task that cannot finish before Storage exists. Do not preserve these inconsistencies merely because they already exist. Clarify conditional ownership, move the pending obligation to the correct later story where appropriate, and preserve Stage 2 completion only if its actual acceptance criteria remain satisfied.

### Step 2 — revise the blueprint first

The roadmap declares its acceptance criteria subordinate to the approved blueprint. Therefore:

1. update `IMPLEMENTATION-BLUEPRINT.md` and its change history first;
2. establish the new milestone definitions and approved scope split there;
3. only then update `TODO-ROADMAP.md` to match;
4. finally make the smallest required consistency updates to supporting documents.

Do not change roadmap acceptance criteria first and retroactively justify them.

## 3. Preserve sunk implementation

Do not propose or perform these refactors as part of this task:

- Prisma + Kysely to one data-access library;
- typed EAV to JSONB attributes;
- PostgreSQL jobs/outbox to a second temporary synchronous path;
- semantic UI facade to direct PrimeVue imports;
- generated OpenAPI contracts to handwritten duplicated types;
- current auth/session/RBAC to a simplified replacement;
- current media processing to another temporary upload pipeline;
- modular monolith to another topology;
- removal of working transaction-aware ports, audit, idempotency, optimistic concurrency, projection writes, CI gates, or boundary checks.

These might have reduced a greenfield MVP, but the repository is no longer greenfield. Preserve verified implementation and use it even where it is more capable than the validation release requires.

For a designed but unimplemented advanced feature, **move it rather than delete it**:

- retain its story ID and ADR reference;
- retain its original acceptance criteria verbatim under the production baseline;
- remove it from the validation-release critical path;
- mark it `post-validation / revalidation required`;
- if later evidence changes the decision, create a superseding ADR instead of rewriting accepted history.

## 4. Delivery model and versioning

Define three horizons consistently in the blueprint and roadmap:

| Horizon | Meaning |
| --- | --- |
| Implemented foundation | Verified completed work inherited by the release; never scheduled for replacement merely to simplify the plan |
| `0.1.0 Usable Validation Release` | The smallest safe end-to-end product that tests the hypothesis above with real inventory |
| `1.0.0 Production Baseline` | The retained full design: complete search/privacy modes, labels/scanner, portability, scale and operational hardening |

### Required versioning-policy correction

The current policy increments `MINOR` for every completed feature step, while the proposed first release aggregates Foundation, Catalog/Media, Storage, Lean Search, and Backup. Resolve this explicitly in `docs/project/versioning.md`:

- `0.1.0-dev.N` may aggregate multiple pre-release work packages before the first normal release;
- `0.1.0` is the first usable validation release, not one individual feature step;
- after `0.1.0`, each completed normal feature step increments `MINOR` and fixes increment `PATCH`;
- optional QR delivered before the `0.1.0` cut may be included; if delivered afterward, it is a normal feature increment;
- update the planned milestone table so it does not simultaneously assign `0.1.0`, `0.2.0`, and later versions to work already bundled into the first release.

This is an explicit approved policy adjustment, not a silent exception.

## 5. Blocking scope for `0.1.0`

### 5.1 Verified completed foundation

After the audit, identify the exact inherited baseline. It is expected to include substantial parts of Foundation, auth/RBAC, localization, contracts, Catalog, typed EAV, Item/media flows, transaction ports, projection writes, and jobs/outbox, but only the audit may mark them complete.

Do not rebuild verified features in simpler form. Do not leave cross-cutting checkboxes stale when completion can be demonstrated. Do not mark an entire infrastructure workstream complete merely because one completed feature used part of it.

### 5.2 Storage core — blocking

Storage is the main missing product capability. The release must provide:

- nested StorageNode create, edit, archive, browse, breadcrumb, children and paged direct contents;
- Item assignment/move and append-only movement history;
- complete current location on the Item card and in search results;
- safe container/subtree move;
- current authorization and exact-path privacy on every shipped route;
- usable mobile-width browse and destination-picker flows.

Keep the approved `parent_id + ltree path + depth + tree_root_id` model, Kysely ownership, single-client transactions, and transaction-aware ports.

The following are mandatory correctness requirements, not optional production hardening:

- reject moving a node into its own descendant without partial updates;
- deterministically serialize opposing moves and retain an acyclic connected tree;
- update `parent_id`, `path`, `depth`, and `tree_root_id` for the complete affected subtree;
- keep movement, projection, audit, outbox, and source writes atomic through the correct client;
- reject missing or archived Item destinations and roll back the complete mutation;
- serialize Item create/move against destination-node move/rename under the shared root-lock rule;
- make the committed Item breadcrumb consistent with the final tree state.

Potential deferrals are limited to product richness or scale certification, for example extended StorageNode media UX, non-essential card polish, and the 1,000/10,000-descendant performance matrix. If StorageNode dynamic attributes are deferred, defer their whole acceptance contract and owned critical test together; do not ship a partial aggregate that claims those capabilities.

### 5.3 Lean Search — blocking, but not pre-built

Describe the current state accurately:

- the repository already contains an `item_search` table/index foundation and some CAT-owned synchronous Item projection writes;
- SRCH-01 as a whole is not complete;
- required extensions/indexes, complete builders, both source-client adapters, all invalidation paths, rebuild behavior, query execution, cursors, filtering, API and UI still require implementation or fresh verification.

Do not describe this milestone as “adding UI to finished search infrastructure.” Search is the largest schedule uncertainty.

Required Search delivery:

- `pg_trgm`/`unaccent` and the indexes actually required by delivered queries;
- role-safe full/public vector and typed-attribute builders;
- Prisma and Kysely `SearchProjectionPort` behavior required by Item and Storage transactions;
- authenticated text search over permitted names and searchable values;
- category, lifecycle-status, and storage-location filters;
- stable bounded pagination using the approved cursor rules;
- mobile search/result UI with English and Ukrainian loading, empty and error states;
- current permitted location in results;
- server-side authorization and negative privacy tests;
- idempotent/resumable rebuild behavior for invalidations used by shipped mutable data;
- query/rollback/rebuild integration tests on real PostgreSQL.

The complete generic typed-filter builder may be split: only filter types explicitly exposed by the `0.1.0` API/UI block the release. Preserve the remaining type-aware filter acceptance criteria under the production baseline.

Deferred Search work may include saved views, bulk actions, 100k certification, extensive relevance tuning, operational dashboards, and metrics beyond safe operation of shipped paths. Do not defer projection correctness or required rebuild processing.

### 5.4 Search invalidation — all eight paths are in scope

Because Stage 2 already exposes mutable Items, categories, field definitions/options and visibility, and Storage adds node mutations, all eight blueprint invalidator rows affect the validation release.

| Blueprint event/path | `0.1.0` requirement |
| --- | --- |
| `ItemCreated` / `AttributeChanged` | Complete and regression-test the synchronous full row write; do not assume CAT coverage proves the full SRCH builder |
| `NodeMoved` | Synchronously update subtree path/visibility data and enqueue required vector rebuild work |
| `NodeRenamed` | Synchronously update breadcrumbs/paths for nested Items and enqueue required vector rebuild work |
| `NodeVisibilityChanged` | Synchronously update effective visibility and every public projection affected |
| `CategoryRenamed` | Preserve the existing transactional outbox emission and implement/test the affected-Item rebuild consumer |
| `FieldDefinitionChanged` | Preserve emission and implement/test attribute/vector rebuild for affected Items |
| `FieldOptionLabelChanged` | Implement/test affected-Item vector rebuild |
| `ItemVisibilityChanged` | Synchronously remove or update visibility-sensitive public projections |

Required job contracts include the search rebuild job types actually needed for these paths, including safe retry, deduplication/idempotency and restart behavior. Stale-count dashboards and broad operations UI may remain deferred, but a restart may not leave shipped search permanently wrong.

The container-rename acceptance test is explicitly blocking: renaming a container must synchronously update breadcrumbs for all nested Items visible in default search/results.

### 5.5 Operational backup/restore — blocking

The validation release requires data recovery, not the complete interchange platform:

- PostgreSQL dump procedure compatible with the migration stream;
- consistent media-directory backup procedure;
- capture of non-secret configuration and release/schema version;
- separate secure handling of secrets;
- restore into a clean disposable environment;
- one recorded smoke test covering health, sign-in, representative counts, and media availability.

Retain PORT-01 and PORT-02 for later: canonical portable manifest, deterministic serialization, hostile-archive dry run, resumable export/import, checkpointed apply, complete checksum comparison, and application UI.

### 5.6 QR — non-blocking stretch goal

QR is not part of the core product hypothesis and must not block `0.1.0`.

If it fits without delaying Storage, Search, Backup, or dogfooding, add a separate convenience-QR story:

- encode the canonical authenticated Item/StorageNode route based on stable public ID;
- native phone camera opens the route;
- sign-in returns the user to the target;
- clearly label it as an authenticated convenience link, not a public/revocable scan token.

Do not mark LAB-01 complete. Preserve LAB-01 through LAB-03 and ADR-025 intact for the production baseline: HMAC token derivation, revocation/reissue, key rotation, Code 128, template/batch persistence, server PDF rendering, physical scan matrix, and in-app scanner.

### 5.7 Dogfooding — calendar gate

After the blocking implementation is deployable:

- enter 50–100 representative real Items across several categories;
- create at least three storage levels;
- move Items and at least one container;
- find Items by name, delivered searchable values and location;
- perform and record one clean restore smoke;
- use the installation for at least seven calendar days;
- record observed friction and rank the next feature candidates.

This is **at least one elapsed calendar week**, not one person-week of implementation effort. Development/fixes may overlap, but release evidence cannot be claimed before the observation period exists.

## 6. Critical acceptance-test ownership

Replace the vague instruction “do not require all 24 production acceptance tests” with this rule:

> `0.1.0` requires every critical acceptance test owned by a shipped story or exercised dependency. Tests owned only by deferred stories move with those stories; no integrity or privacy test may be dropped merely because the full 24-test production gate is deferred.

Apply the current 24-test list as follows:

| Disposition | Critical tests |
| --- | --- |
| Required for `0.1.0` | own-descendant move rejection; opposing-move serialization; full subtree path/depth/root update; container rename updates nested Item breadcrumbs; stale rows remain safely listable during rebuild; Prisma source/projection/outbox commit and rollback; Kysely node move uses supplied transaction; Prisma Item move atomically updates destination/history/audit/projection/outbox; archived/missing destination rollback; Item/node race serialization; multiselect scalar-row integrity; configuration precedence; public-projection removal after visibility changes; private-value non-inference on every shipped lower-role search surface; unlisted exclusion/direct-access behavior on every shipped relevant surface; generated-client runtime validation; English/Ukrainian switching |
| Conditional on shipped scope | StorageNode attribute rollback test only if node attributes ship; public ID/QR rename test only if convenience QR ships |
| Split | “resume reindex/import” becomes: reindex restart/idempotency is required; import restart remains deferred with PORT-02 |
| Deferred with owner story | label-token reprint/revocation/key rotation; bulk mixed-outcome replay; portable export/import round trip |

If the audit reveals another test is exercised by a `0.1.0` path, add it to the required subset. The table is a minimum, not a waiver.

## 7. Estimate

Replace the earlier 5–8 week estimate with:

- **7–11 person-weeks of engineering remaining** for one experienced full-time developer from the inspected baseline;
- Search is the main uncertainty because substantial SRCH-01/SRCH-02 work remains and all eight invalidation paths affect shipped mutations;
- Storage remains approximately 3–4 weeks unless the audit finds meaningful implementation beyond the roadmap;
- dogfooding adds **at least seven elapsed calendar days**, not another full person-week;
- expected calendar time for one developer is roughly **8–12 weeks**, depending on overlap between observation and fixes.

Require re-estimation after the implementation audit and again after the first Search schema/query/invalidation vertical slice. Present estimates as forecasts, not acceptance criteria.

## 8. Required document edits

### `IMPLEMENTATION-BLUEPRINT.md`

- bump the document version and record this scope/sequencing revision;
- define Implemented Foundation, `0.1.0 Usable Validation Release`, Post-validation Backlog, and `1.0.0 Production Baseline`;
- replace statements that equate all Stages 0–6 with the first usable MVP;
- annotate existing technical sections by delivery horizon instead of deleting them;
- add the exact Storage correctness, Search/invalidation, Backup, and optional QR contracts above;
- split validation-release gates from production-baseline gates;
- retain accepted ADRs and the full future LAB/PORT/Search designs;
- record the revised estimate and its person-week/calendar distinction.

### `TODO-ROADMAP.md`

- update only after the blueprint revision is internally consistent;
- preserve verified completed work, but correct documented checkbox mismatches using audit evidence;
- show a short critical path: audited foundation → Storage → Lean Search → Backup/restore → seven-day dogfooding;
- mark convenience QR as a non-blocking stretch goal;
- split acceptance-test ownership using section 6 above;
- explicitly schedule all eight invalidator paths and the necessary search rebuild jobs;
- retain original deferred story IDs and verbatim production acceptance criteria;
- create separate `0.1.0` and `1.0.0` release gates;
- keep already working checks/CI; do not delete them because they exceed the theoretical minimum.

### Supporting consistency edits

Make only necessary matching changes in:

- `README.md`;
- `AGENTS.md`;
- `docs/project/versioning.md`;
- `CHANGELOG.md`;
- ADR index/status notes only when milestone wording would otherwise mislead.

Do not turn this into a general documentation rewrite.

## 9. `0.1.0` release gate

- [ ] Implementation audit is recorded and roadmap mismatches are resolved.
- [ ] Verified inherited Foundation/Catalog/Media checks remain green for changed areas.
- [ ] Clean compact Docker Compose installation starts; Owner signs in; English/Ukrainian switching works.
- [ ] Item create/edit with custom fields and image works.
- [ ] Nested Storage create/browse and Item/container moves work with the mandatory integrity tests in section 5.2.
- [ ] Lean Search is implemented as described in section 5.3; all eight invalidator paths in section 5.4 are integrated and tested.
- [ ] Search results show the current permitted location; container rename/move and Item move cannot leave committed visible breadcrumbs stale.
- [ ] Unauthorized actors cannot infer private values or exact paths through shipped routes.
- [ ] PostgreSQL, media, and non-secret configuration restore successfully in a clean disposable environment.
- [ ] Required/conditional critical tests are classified and pass according to section 6.
- [ ] Seven calendar days of representative real use and findings are recorded.
- [ ] Known limitations name deferred labels/scanner, portable interchange, saved views/bulk, and scale certification.

Convenience QR is intentionally absent from this blocking checklist.

## 10. Validation and handoff

Before completion:

1. confirm no code, migration, generated artifact, dependency, or runtime configuration changed;
2. confirm no verified completed work was reverted;
3. list and justify every checkbox/status correction;
4. confirm every original story ID and deferred acceptance criterion remains traceable;
5. confirm no accepted ADR was silently contradicted;
6. confirm blueprint, roadmap, README, AGENTS, versioning and changelog use consistent milestone terms;
7. confirm the `0.1.0` graph has no dependency on QR, full Labels/Scanner, saved views, bulk actions, portable import/export, or 100k certification;
8. run `git diff --check` and relevant documentation checks;
9. report the files changed, audit delta, scope mapping, revised estimate, and checks run.

Do not commit, push, tag, release, or open a pull request without separate owner authorization.

## 11. Decision rule

> Preserve verified implementation, require correctness for every shipped path, deliver the smallest coherent inventory loop, and defer only work whose absence cannot corrupt data, leak private information, or invalidate the result of real MVP testing.

## 12. Owner addendum applied with this revision

The implementation of this change request also applies these clarifications:

1. `0.1.0` exposes Lean Search to Viewer, Editor, Owner, and Admin, but not Public. Viewer/Editor receive public/authenticated data only; Owner/Admin exact private lookup is a separately authorized surface. Disabled Public access requires a negative availability test.
2. An audit that cannot establish a status uses `unverified` and refers the item to the owner. It does not infer `not implemented`. Removing an existing completion checkbox requires separate owner confirmation before merge.
3. `CategoryRenamed` and `FieldOptionLabelChanged` retain asynchronous affected-Item rebuild through the transactional outbox. Their bounded prior-label window is documented and must close after retry/restart; breadcrumb and privacy-sensitive updates remain synchronous.
