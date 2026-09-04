# Stage 1 implementation handoff

This record closes the planning portion of the Stage 0 exit gate. It confirms
that the choices intentionally deferred by blueprint section 26 do not affect
schema v1, and assigns an ordered Foundation delivery queue.

## Deferred-choice schema review

| Deferred choice | Schema-v1 conclusion | Boundary that keeps it deferred |
| --- | --- | --- |
| Final public domain | Not required | The canonical base URL is installation configuration governed by ADR-026; identifiers and relational schema do not embed a deployment hostname. |
| Printer-specific profiles | Not required | Schema v1 stores generic, immutable label-template snapshots. Only the approved A4 grid and 50x30 mm templates are MVP scope. |
| Marketplace and carrier connectors | Not required | Provider adapters, listing publication, and carrier jobs remain P1/P2. No provider-specific table or endpoint is needed for the catalog MVP. |
| S3/MinIO deployment | Not required | Local media is the MVP default. Media records use adapter-owned storage keys, so the optional S3-compatible adapter does not change aggregate ownership or schema v1. |
| Separate worker process | Not required | Compact execution is the default. The optional worker consumes the same job/outbox records and changes only the deployment composition. |

These conclusions are confirmations of the approved blueprint, not new product
decisions. A future deferred choice that changes a module boundary, schema
contract, security policy, or public API requires an ADR before implementation.

## Ownership

The repository project owner is accountable for Stage 1. The active
implementation owner (human or coding agent working for the project owner) owns
each queued package until explicitly reassigned. Review ownership remains with
the project owner; no package is self-approved merely because it was produced by
an agent.

## Ordered delivery queue

| Order | Package | Assigned owner | Entry condition | Outcome |
| ---: | --- | --- | --- | --- |
| 1 | FND-01A | Foundation implementation owner | Stage 0 exit recorded | Pinned workspace and repository skeleton |
| 2 | FND-01B | Foundation implementation owner | FND-01A | Stable root commands and shared checks |
| 3 | FND-01C | Foundation implementation owner | FND-01B | Boundary enforcement and clean-checkout proof |
| 4 | FND-01D | Foundation implementation owner | FND-01A; may overlap 01B/01C | Frontend shell, providers, state boundaries, full UI facade baseline |
| 5 | FND-02A | Foundation implementation owner | FND-01 complete | Compact PostgreSQL/migration/API/web/Caddy composition |
| 6 | FND-02B | Foundation implementation owner | FND-02A | Configuration authority, persistence, health, and `/meta` |
| 7 | FND-02C | Foundation implementation owner | FND-02B | Compact/expanded profiles and Compose validation |
| 8 | FND-03A-C | Foundation implementation owner | FND-01 and API skeleton | Normalized OpenAPI, generated artifacts, and drift checks |
| 9 | FND-05A-C | Foundation implementation owner | FND-01; may run with FND-02/03 | English/Ukrainian foundation and coverage gate |
| 10 | FND-04A-C | Foundation implementation owner | FND-02 and initial migrations | Authentication, sessions, invitations, roles, and security audit |

Within an order row, lettered packages merge in letter order. FND-03 and FND-05
may proceed in parallel only after their stated entry conditions are met. Stage
1 exits only when FND-01 through FND-05 acceptance criteria and the complete
root pipeline pass.
