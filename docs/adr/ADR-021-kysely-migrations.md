# ADR-021: Kysely is the single migration authority

- **Status:** Accepted

## Context

Prisma and Kysely both access the same database; two migration histories would
permit drift and conflicting DDL ownership.

## Decision

The complete schema uses one ordered Kysely migration stream. Prisma Migrate
never runs in deployment; Prisma schema generation is verified against the
migrated database in CI.

## Consequences

Raw or specialized PostgreSQL features remain expressible, while clean-database
and drift checks become mandatory release gates.
