# Authentication implementation status

FND-04 currently provides the Auth/Audit migrations and the Auth credential
adapter exported as `PasswordHasher` from `@inventory-atlas/backend`. Owner
bootstrap, sign-in, sessions, invitations and authorization remain roadmap tasks.

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

Verified for this increment: all 45 unit tests and 34 PostgreSQL integration
tests passed, along with lint, types/boundaries/contracts, build, schema-version,
formatting and dependency-license checks. The production API image built from
the frozen lockfile also hashed and verified a synthetic password as its non-root
runtime user, without network access. The first overloaded parallel unit run hit
a timeout; the complete rerun passed without changing timeouts or work factors.

The subsequent [dependency remediation](dependency-remediation.md) resolves the
owner-approved Prisma CLI license exception and the dependency audit findings.
Auth Prisma models and migrated-schema drift verification remain to be implemented;
the existing generated Prisma files have not been edited manually.
