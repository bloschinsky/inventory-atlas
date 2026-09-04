# ADR-022: Cross-owner writes use transaction-aware ports

- **Status:** Accepted

## Context

Item and StorageNode aggregate mutations must atomically update attributes,
movement history, audit, idempotency, projections, and outbox rows owned by
other modules without mixing Prisma and Kysely transactions.

## Decision

`AttributeValuePort`, `MovementHistoryPort`, `AuditPort`, `IdempotencyPort`,
`SearchProjectionPort`, and `OutboxPort` accept the existing source transaction
and execute only narrow parameterized writes.

## Consequences

No adapter opens a nested transaction or exposes a foreign general repository.
Both source-client paths require rollback integration tests.
