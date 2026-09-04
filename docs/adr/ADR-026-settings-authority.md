# ADR-026: Database settings become authoritative after bootstrap

- **Status:** Accepted

## Context

Several settings appeared in both environment and `app_settings`, leaving
runtime precedence ambiguous.

## Decision

The first initialization seeds mutable settings from environment, then the
database is authoritative. Infrastructure and safety ceilings remain
environment-only. Production conflicts in canonical base URL or public catalog
mode fail startup; default-locale mismatch warns and the database wins.

## Consequences

Configuration changes are predictable and auditable; startup validation and
ceiling enforcement are required.
