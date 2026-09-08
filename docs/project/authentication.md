# Authentication implementation status

FND-04 provides the Auth/Audit migrations, generated Prisma models,
migrated-schema drift verification, the Auth credential adapter, one-time
first-Owner bootstrap, opaque sessions, invitations, role policy, rate limits,
security audit events, and the browser account-administration flows.

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

## Opaque sessions and CSRF

`SessionService` issues a fresh 256-bit base64url session token after verifying
an active account with Argon2id. The token, its session-bound CSRF secret and the
normalized client IP are domain-separated with HMAC-SHA-256 under
`SESSION_SECRET`; only their 64-character lowercase hexadecimal digests enter
PostgreSQL. Unknown email addresses traverse a fixed synthetic Argon2id hash so
credential failures use the same verification path without storing or logging
request secrets.

Sessions have a 30-minute sliding idle lifetime and a fixed 30-day absolute
lifetime. A successful lookup advances `last_seen_at` and `idle_expires_at` up to
the absolute boundary. Expired, archived-user and disabled-user sessions fail
closed and are marked revoked. Sign-out revokes the current row; targeted
revocation can affect only another session owned by the current actor.

The API exposes `POST /api/v1/auth/session`, `GET /api/v1/auth/me`,
`DELETE /api/v1/auth/session`, and `DELETE /api/v1/auth/sessions/{id}`. The raw
session token is sent only in the `inventory_atlas_session` cookie with
`HttpOnly`, `SameSite=Lax`, `Path=/`, a bounded `Max-Age`, and `Secure` whenever
`COOKIE_SECURE=true`. The separate CSRF token is returned by sign-in and
`/auth/me`; every authenticated mutation requires the exact value in
`X-CSRF-Token`. Responses containing session material use
`Cache-Control: no-store`, and sign-out or a failed current-session lookup
expires the browser cookie.

The native `argon2` dependency is pinned to the approved `0.45.1` baseline, with
its installation script explicitly enabled in `pnpm-workspace.yaml`. The wrapper
uses the [node-argon2 API](https://github.com/ranisalt/node-argon2). Docker builds
install the same pinned package and native binding as the development workspace.

## Invitations and user administration

An Owner, or an Admin with the database-authoritative `manageUsers` capability,
can issue a seven-day invitation. The API returns its 256-bit token once and
PostgreSQL stores only a domain-separated HMAC-SHA-256 digest. Issuing another
active invitation for the same normalized email revokes the earlier one.
Acceptance validates expiry and revocation, hashes the new password before the
transaction, and atomically creates the account and consumes the invitation.

User and invitation mutations use resource versions. Role, disable and archive
operations revoke the affected account's active sessions. Operations affecting
an Owner require an authenticated Owner plus explicit confirmation, and a table
lock serializes the active-Owner count so the last Owner cannot be disabled,
archived or demoted. Admin can manage non-Owner accounts but can neither grant
nor remove Owner authority.

## Capabilities and rate limits

The section 16.1 matrix is encoded as named server capabilities and returned by
`GET /api/v1/auth/me`. Owner always receives every capability. Public catalog
viewing follows installation configuration; Viewer and Editor permissions are
fixed; Admin's limited capabilities come from the validated
`admin_capabilities` database setting. Its default enables non-Owner user and
settings administration while portability, integrations, audit and job
administration require explicit grants.

Sign-in is limited to five attempts per hashed IP/email identity per 15 minutes.
Invitation acceptance is limited to ten attempts per hashed IP/token identity
per 15 minutes. Successful use clears its bucket; rejected requests return 429
and `Retry-After`. Limiter keys are HMAC digests, so raw emails, IP addresses and
tokens are not retained in memory.

## Security audit

Sign-in success and denial, session revocation, invitation issue/revoke/accept,
and user role/status/archive changes append audit rows in the owning business
transaction where one exists. Audit JSON is a fixed safe projection containing
only results, roles, statuses and boolean state. It excludes passwords, session
and invitation tokens, credential hashes and email addresses. Client IPs use the
same domain-separated HMAC policy as sessions; user-agent and request identifiers
are normalized and bounded.

## API and browser flows

The API adds session listing, invitation listing/issue/revoke/accept, user
listing, versioned role/status changes and account archival. Authenticated
mutations require the session-bound CSRF token. Generated OpenAPI declarations,
JavaScript types and Zod schemas cover every route under one checksum.

Vue pages provide sign-in and sign-out, invitation acceptance, active-session
revocation, user/role administration and one-time invitation-token display.
Vue Query owns every server collection and mutation; Pinia retains only the
current session summary and CSRF value. English and Ukrainian strings are kept
in the shared locale resources, and application code uses only the semantic UI
facade.

## Verification

- Unit tests use real Argon2id: encoded parameters, fresh salts, mismatches,
  Unicode/whitespace preservation, long passwords, embedded nulls, earlier work
  factors and corrupt/unsupported hashes.
- Real-PostgreSQL integration tests round-trip an encoded credential through the
  migrated `users.password_hash` column and verify it after reading it back.
- Real-PostgreSQL session tests cover opaque token/CSRF/IP hashing, independent
  credentials, idle refresh, absolute expiry, fail-closed revocation and current
  or other-owned session revocation.
- API tests cover cookie parsing ambiguity, fixed cookie attributes, CSRF on
  mutations, cookie clearing, current-session recovery and non-disclosing
  targeted revocation errors. The generated OpenAPI, declarations, JavaScript
  JSDoc and Zod artifacts include the four session endpoints under one checksum.
- Run `pnpm test`, `pnpm test:integration`, `pnpm lint`, `pnpm check`, `pnpm build`
  and `pnpm license:check` through the documented Docker developer workflow.

Verified for this increment: all 61 unit tests and 46 PostgreSQL integration
tests passed, along with lint, types/boundaries/contracts, build, schema,
localization and formatting checks. The earlier credential increment also
verified the production API image and dependency-license policy.

The subsequent [dependency remediation](dependency-remediation.md) resolves the
owner-approved Prisma CLI license exception and the dependency audit findings.
The committed Auth Prisma client is generated from `db/prisma/schema.prisma`.
An integration check applies every Kysely migration to an isolated PostgreSQL
schema, removes only Kysely's bookkeeping tables from the introspection scope,
and fails when Prisma's introspected model differs from the committed schema.
Unsupported check constraints and the append-only audit trigger remain enforced
by the Kysely migration and their PostgreSQL integration tests.
