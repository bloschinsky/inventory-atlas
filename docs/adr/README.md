# Architecture decision records

Architecture decisions are frozen inputs to implementation. ADR-001 through
ADR-020 reproduce the approved decision text from the product design document;
ADR-021 through ADR-026 reproduce the implementation decisions introduced by
the approved blueprint.

All records currently have **Accepted** status. Changing a decision requires a
new superseding ADR; existing records are not rewritten.

| ADR | Decision |
| --- | --- |
| [ADR-001](ADR-001-modular-monolith.md) | Modular monolith |
| [ADR-002](ADR-002-postgresql-source-of-truth.md) | PostgreSQL source of truth |
| [ADR-003](ADR-003-storage-tree.md) | Storage tree representation and locking |
| [ADR-004](ADR-004-typed-eav.md) | Typed EAV |
| [ADR-005](ADR-005-rest-openapi.md) | REST and OpenAPI |
| [ADR-006](ADR-006-language-and-contracts.md) | Frontend/backend languages and generated contracts |
| [ADR-007](ADR-007-ui-facade.md) | PrimeVue facade and semantic tokens |
| [ADR-008](ADR-008-portability-and-backup.md) | Portable export versus operational backup |
| [ADR-009](ADR-009-private-storage-path.md) | Private exact storage paths |
| [ADR-010](ADR-010-search-read-model.md) | Materialized search read model |
| [ADR-011](ADR-011-heic.md) | HEIC processing and licensing review |
| [ADR-012](ADR-012-data-access.md) | Prisma/Kysely data-access ownership |
| [ADR-013](ADR-013-projection-timing.md) | Projection timing |
| [ADR-014](ADR-014-locales.md) | English and Ukrainian locales |
| [ADR-015](ADR-015-single-client-transactions.md) | Single-client transactions |
| [ADR-016](ADR-016-search-privacy.md) | Search privacy and discoverability |
| [ADR-017](ADR-017-search-invalidator-registry.md) | Search invalidator registry |
| [ADR-018](ADR-018-openapi-contract-source.md) | One OpenAPI contract source |
| [ADR-019](ADR-019-bulk-conflicts.md) | Per-item bulk conflict reports |
| [ADR-020](ADR-020-ltree-label.md) | Stable `ltree` node labels |
| [ADR-021](ADR-021-kysely-migrations.md) | Kysely migration authority |
| [ADR-022](ADR-022-transaction-aware-ports.md) | Transaction-aware cross-owner ports |
| [ADR-023](ADR-023-projection-path-locking.md) | Projection path resolution and locks |
| [ADR-024](ADR-024-scalar-row-eav.md) | Canonical scalar-row EAV |
| [ADR-025](ADR-025-versioned-scan-tokens.md) | Reproducible versioned scan tokens |
| [ADR-026](ADR-026-settings-authority.md) | Installation-setting authority |

## Sources

- [Approved product design v0.3.1](../product/inventory-atlas-design-document-v0.3.1.pdf), section 16.1
- [Implementation blueprint v0.2](../../IMPLEMENTATION-BLUEPRINT.md), sections 25 and 25.1
