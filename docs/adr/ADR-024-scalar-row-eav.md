# ADR-024: EAV uses typed scalar rows as its only persistence form

- **Status:** Accepted

## Context

A generic `value_json`, or supporting both arrays and rows for multiselect,
would create ambiguous representations and move type/reference integrity out of
the database.

## Decision

Every dynamic value is stored in an explicit typed scalar slot with `position`;
no generic `value_json` is part of schema v1. Multiselect uses one FK-backed
`value_option_id` row per selected option, while arrays exist only in API/search
projections. `repeatable` is invalid for select and multiselect.

## Consequences

Money/reference constraints, referential integrity, and ordering are explicit;
schema changes require migrations, and API adapters assemble/disassemble
projected arrays at the boundary.
