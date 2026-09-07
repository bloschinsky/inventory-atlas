# Authentication implementation status

FND-04 currently provides the Auth/Audit migrations, generated Prisma models,
migrated-schema drift verification and the Auth credential adapter exported as
`PasswordHasher` from `@inventory-atlas/backend`, plus one-time first-Owner
bootstrap. Sign-in, sessions, invitations and authorization remain roadmap tasks.

## First Owner bootstrap

`bootstrapFirstOwner` normalizes the email, hashes the credential before opening
the transaction, and then takes a PostgreSQL table lock around the empty-user
check and Owner insert. Exactly one concurrent bootstrap succeeds, including
when another user writer does not participate in an application advisory-lock
protocol. Once any user exists, bootstrap stays unavailable. The returned value
contains only the Owner's public account fields and never the credential hash.

## Password credentials

`PasswordHasher.hash(password)` asynchronously creates an Argon2id v19 encoded
hash using 64 MiB memory, three iterations, four lanes, a fresh cryptographically
random 16-byte salt and a 32-byte digest. This follows the second recommended
profile in [RFC 9106 section 4](https://www.rfc-editor.org/rfc/rfc9106.html#section-4).
The encoded string includes the algorithm, version, work factors, salt and digest;
store it intact in `users.password_hash`. Never log passwords or encoded hashes.

`PasswordHasher.verify(encodedHash, password)` uses the parameters recorded in
the hash, so changing creation defaults will not invalidate existing credentials.
It rejects mismatches, malformed hashes and non-Argon2id algorithms with `false`.
Passwords are not trimmed, normalized or truncated. Password enrollment policy,
request size limits, login throttling and hash-upgrade orchestration belong to
the forthcoming Auth application flows. Stored hashes must come from the trusted
credential store, never directly from request input.

The native `argon2` dependency is pinned to the approved `0.45.1` baseline, with
its installation script explicitly enabled in `pnpm-workspace.yaml`. The wrapper
uses the [node-argon2 API](https://github.com/ranisalt/node-argon2). Docker builds
install the same pinned package and native binding as the development workspace.

## Verification

- Unit tests use real Argon2id: encoded parameters, fresh salts, mismatches,
  Unicode/whitespace preservation, long passwords, embedded nulls, earlier work
  factors and corrupt/unsupported hashes.
- Real-PostgreSQL integration tests round-trip an encoded credential through the
  migrated `users.password_hash` column and verify it after reading it back.
- Run `pnpm test`, `pnpm test:integration`, `pnpm lint`, `pnpm check`, `pnpm build`
  and `pnpm license:check` through the documented Docker developer workflow.

Verified for this increment: all 51 unit tests and 37 PostgreSQL integration
tests passed, along with Prisma validation/generation, lint,
types/boundaries/contracts, build and formatting checks. The earlier credential
increment also verified the production API image and dependency-license policy.

The subsequent [dependency remediation](dependency-remediation.md) resolves the
owner-approved Prisma CLI license exception and the dependency audit findings.
The committed Auth Prisma client is generated from `db/prisma/schema.prisma`.
An integration check applies every Kysely migration to an isolated PostgreSQL
schema, removes only Kysely's bookkeeping tables from the introspection scope,
and fails when Prisma's introspected model differs from the committed schema.
Unsupported check constraints and the append-only audit trigger remain enforced
by the Kysely migration and their PostgreSQL integration tests.
