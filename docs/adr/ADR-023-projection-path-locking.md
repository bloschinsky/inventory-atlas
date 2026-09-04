# ADR-023: Projection resolves storage paths under root advisory locks

- **Status:** Accepted

## Context

A separate destination pre-check can race a concurrent node move/rename and
conflicts with the approved single-transaction/client boundary.

## Decision

The synchronous projection statement resolves the destination path, visibility,
and root from `storage_nodes` using the supplied source transaction. It first
acquires the same root advisory lock used by node path mutations. Missing or
archived destinations fail the aggregate transaction.

## Consequences

This is the only named cross-owner Storage read exception and returns no Storage
domain rows. All breadcrumb/visibility-changing node mutations must take the
same lock.
