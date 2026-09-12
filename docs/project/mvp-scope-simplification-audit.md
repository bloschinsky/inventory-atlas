# MVP scope-simplification implementation audit

> Audit date: 2026-09-12
>
> Inspected baseline: `fe818ff0a2bcc307d873a960bab24b03de8bbd6a` (`master`)
>
> Change request: [Inventory Atlas MVP Scope and Sequencing Revision v2](inventory-atlas-mvp-scope-simplification-task-v2.md)

## Status rules

This audit uses `verified complete`, `partially complete`, `not implemented`, `roadmap mismatch`, and `unverified`. `Not implemented` means the expected module, route/UI surface, persistence/runtime behavior, and tests were affirmatively checked and found absent. Insufficient evidence is `unverified` and must go to the owner; it is never converted to `not implemented` automatically. Removing an existing completion mark requires separate owner confirmation before merge.

No existing `[x]` was removed by this revision.

## Audited delta

| Area | Classification | Evidence inspected | Planning result |
| --- | --- | --- | --- |
| Stage 0 Discovery | verified complete | Versioned design/ADR/docs, reference catalog/storage/media/label fixtures, Stage 1 handoff, completed roadmap evidence | Inherited foundation; no status change |
| Stage 1 Foundation | verified complete | Root scripts, workspace packages, Kysely migration runner, Compose/dev instructions, CI, auth/API/i18n/UI-facade tests and docs | Inherited foundation; no status change |
| Stage 2 Catalog/Schema/Media | verified complete | Migrations `0003`-`0008`, Catalog/Schema/Media services, controllers, generated contracts, Vue flows, PostgreSQL/unit/API tests, implementation notes | Inherited foundation; Stage 2 stays complete |
| CAT-03 destination path | roadmap mismatch | `TransactionalSearchProjectionPort` rejects every non-null `storageNodeId`; no `storage_nodes` table exists yet | Moved the unchecked conditional task to STO-03 without changing Stage 2 acceptance criteria |
| Database/transaction workstream | partially complete | `database.ts`, Prisma drift test, migration-backed integration tests, `transaction-ports.ts`, dual-client attribute adapter, blueprint table ownership registry | Checked only verified foundation items; kept complete supplied-transaction proof and Prisma/Kysely generated-type drift open |
| Jobs/outbox | partially complete | Migrations `0004`/`0008`, job repository/runner/policy, outbox dispatcher, compact/worker runtime and PostgreSQL tests | Checked queue/runtime foundation; Search handlers remain blocking and Label/Portability handlers move with their stories |
| Search job identifier | roadmap mismatch | Source outbox producers use `search.rebuild-items.v1`; `job-policy.ts` declares `search.rebuild-items-v1` | Exact registration remains unchecked for resolution in the first Search vertical slice |
| `item_search` and CAT projection writes | partially complete | Migration `0006`, `TransactionalSearchProjectionPort`, Item mutation/invalidation services and rollback tests | Split SRCH-01 schema task: preserved foundation is checked; extensions, full builders, Storage behavior, rebuild, query/API/UI remain open |
| Storage | not implemented | No backend Storage module, migration, API controller, web feature/page, or Storage integration/E2E suite; only predeclared nullable relations, movement table/port, fixtures, and inaccessible route baseline exist | STO-01/02/03 are the main `0.1.0` implementation block |
| Search query product surface | not implemented | No Search backend module/query service/controller, generated Search operation, web Search feature/page, or Search integration/E2E suite | Lean Search is blocking and is not described as UI over completed infrastructure |
| Labels/Scanner | not implemented | No Labels module/tables/controllers/UI/handlers; only reference proofs, approved design, route placeholder, and reserved job identifier exist | LAB-01/02/03 retained verbatim as post-validation/revalidation work; convenience QR is a separate stretch story |
| Portable export/import | not implemented | No Portability module/tables/controllers/UI/handlers or archive round-trip tests | PORT-01/02 retained verbatim as post-validation/revalidation work |
| Operational backup/restore | not implemented | Compact persistence drill exists, but no migration-compatible dump/media/config backup runbook, clean restore procedure, or recorded recovery smoke exists | Minimal operational PORT-03 subset blocks `0.1.0` |
| CI and operating docs | partially complete | CI runs license/security/Prisma/lint/check/unit/integration/build/runtime smoke; development docs record additional local release checks | Existing gates stay; production release artifacts, full restore/release pipeline, and deferred-surface operations remain open |

The absence classifications above came from repository-wide file and symbol searches plus direct inspection of the composition roots and tests. No unchecked area was labelled absent merely because a roadmap checkbox was open.

## Checkbox/status corrections

The following unchecked roadmap entries now have direct implementation evidence and were marked complete:

1. Kysely is the sole schema migration runner.
2. Prisma Migrate is absent from deployment; runtime migration uses the Kysely entry point.
3. CI applies the migration stream to clean PostgreSQL through its integration suite.
4. `TransactionContext` plus Prisma/Kysely adapters exist for SearchProjection, Outbox, MovementHistory, Audit, AttributeValue, and Idempotency.
5. The blueprint contains the reviewed table-owner/read-client/write-path registry.
6. PostgreSQL jobs/outbox migrations, indexes, constraints, and deduplication keys exist.
7. Queue claim, lease, heartbeat, retry/backoff, dead, and cancellation behavior exists and is tested.
8. Transactional outbox dispatch creates/wakes an idempotent job and marks the message in one Kysely transaction.
9. Per-type concurrency plus compact/expanded runner selection exists and is tested.
10. Expired-lease/restart foundation, duplicate-message, and dead-letter behavior is tested.
11. The existing `item_search` full/public vector, JSONB, stable-order, and category/status index foundation is recorded as complete after splitting it from missing `pg_trgm`/`unaccent` and query-specific indexes.
12. Generated Zod runtime contracts reject an invalid mutation payload, and the API performs backend DTO validation before invoking the Item mutation.
13. English default/Ukrainian switching evidence already owned by completed FND-05 is reflected in the critical-test table.

The exact initial job-type registration was deliberately not checked: its Search identifier mismatch is recorded above. No completion checkbox was removed, so the separate owner-confirmation rule was not triggered.

## `0.1.0` role decision for Search

Viewer, Editor, Owner, and Admin receive the authenticated Lean Search surface. Viewer/Editor queries use only public/authenticated vectors, attributes, locations, filters, and counts. Owner/Admin additionally receive a separately authorized exact private-EAV lookup; private values never enter shared projections, facets, or counts.

Public Search does not ship in `0.1.0`. The API rejects unauthenticated Search requests and the UI exposes no Public Search route. SRCH-03 therefore requires negative unavailability coverage for Public, private-value non-inference coverage for both Viewer and Editor, and explicit authorization coverage for the Owner/Admin private lookup. Any later Public Search surface inherits the complete lower-role privacy suite.

## Traceability and retained scope

All original FND, CAT, MED, STO, SRCH, LAB, and PORT story IDs remain in the blueprint and roadmap. Their production acceptance criteria remain verbatim. SRCH-04, LAB-01 through LAB-03, PORT-01/02, generic typed-filter breadth, Public Search, scale certification, and production-only operational hardening are labelled `post-validation / revalidation required`, not deleted.

All eight search invalidator rows remain scheduled. Category and option label changes use the already designed transactional outbox/rebuild path with a documented bounded prior-label window; node breadcrumbs, visibility-sensitive public projections, and Item mutation projection writes remain synchronous. This applies the additional simplification advice without weakening privacy or transaction correctness.

No code, migration, generated artifact, dependency, or runtime configuration was changed by the scope revision.
