# API contract generation

Nest DTOs and Swagger decorators in `apps/api` are the only source for API payload
schemas. The generated contract is rooted at `/api/v1`; health probes remain at
`/health/live` and `/health/ready` as defined by the blueprint.

Run `pnpm contracts:generate` after changing a controller, DTO, response, or API
decorator. This one command writes the deterministically normalized
`docs/api/openapi.json`, TypeScript types, Fetch client operations, JavaScript-friendly
JSDoc declarations, TypeScript declarations, and Zod runtime schemas under
`packages/contracts/src/generated`.

Every generated source file carries `OpenAPI-SHA256: <checksum>`. The normalized spec
carries the same value in `x-spec-checksum`. The checksum is calculated from the
canonical spec without the checksum extension, so rebuilding an equivalent document
does not change it.

`pnpm contracts:check` regenerates the complete output and compares every artifact.
It fails when a committed file is missing, stale, or edited. The root `pnpm check`
and CI both run this gate. The contracts package disables TypeScript's
`exactOptionalPropertyTypes` only while checking generated Fetch transport internals;
the generator currently emits explicit `undefined` values for optional Fetch fields.

Frontend code imports payload types and Zod schemas from `@inventory-atlas/contracts`.
Handwritten frontend declarations named `*Request`, `*Response`, `*Payload`,
`*ProblemDetails`, or `*CursorPage`, and runtime payload schemas in the API layer, are
rejected by `pnpm lint`.
