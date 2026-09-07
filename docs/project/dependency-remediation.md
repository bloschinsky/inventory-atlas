# FND-04 dependency approval and remediation

## Owner-approved scope

The owner approved option A on 2026-09-07: `elkjs@0.11.1` under EPL-2.0 may be
used only as a development/build tool dependency, through
`prisma@7.10.0 -> @prisma/studio-core@0.33.0 -> elkjs@0.11.1`.
This is a package/version/license exception, not a blanket approval of EPL.
Prisma CLI, Prisma Client and the PostgreSQL adapter remain pinned to 7.10.0.

The project does not modify or incorporate elkjs source into application code.
Retain its bundled license and copyright notices. If distributing development
tooling containing elkjs, include the EPL-2.0 text and a notice telling recipients
how to obtain the corresponding source, including any modifications. The npm
package carries its license; the source repository is
[kieler/elkjs](https://github.com/kieler/elkjs). Match the source release to the
installed package version. A changed version, license or production use requires
a fresh review. See [EPL-2.0 sections 1 and 3](https://www.eclipse.org/org/documents/epl-2.0/EPL-2.0.pdf).

React and React DOM 19.2.8 are MIT development dependencies required by Prisma
Studio's peers. They do not change the Vue application architecture. The new
Prisma tooling tree also contains Unlicense packages (`postgres`,
`robust-predicates`) and the combined MIT/ISC notice in `@visx/vendor`; these
permissive licenses are recognized by the gate, retaining all applicable notices.

`license:check` checks installed third-party packages, rejects missing licenses,
and follows workspace runtime dependency edges to reject elkjs in that graph.
Tests cover the exact exception, wrong versions/licenses, transitive runtime use,
missing licenses and development packages physically present in runtime files.

## Vulnerability fixes

| Dependency | Fixed version | Reason and scope |
| --- | --- | --- |
| `js-yaml` via `@hey-api/json-schema-ref-parser@1.4.4` | 4.3.1 | Fixes merge-chain and ordered-map CPU exhaustion; narrow override of the parser's exact 4.2.0 pin |
| `esbuild` | 0.28.1 | Fixes Windows development-server path traversal; one pinned version across consumers |
| `tsx` | 4.23.13 | Supports the patched esbuild 0.28 line; API/worker development only |
| `deepmerge-ts` via `@prisma/config@7.10.0` | 8.0.0 | Fixes recursive graph stack exhaustion discovered when CLI was installed |
| `mysql2` via `prisma@7.10.0` | 3.23.1 | Fixes cleartext authentication downgrade and compressed-protocol decompression DoS discovered when CLI was installed |

The deepmerge-ts major upgrade is limited to Prisma configuration. Version 8
changes Map merging and some TypeScript helper names; the pinned CLI's validation
and isolated generation are checked by `pnpm prisma:check`. This does not approve
arbitrary custom Prisma configuration or MySQL support: Inventory Atlas uses
PostgreSQL. Revisit the overrides when upstream packages adopt patched versions.

Advisories: [YAML merge](https://github.com/advisories/GHSA-52cp-r559-cp3m),
[YAML ordered map](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj),
[esbuild](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr),
[deepmerge-ts](https://github.com/advisories/GHSA-ggr8-5vv4-36mx),
[MySQL authentication](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr),
[MySQL compression](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3).

`pnpm security:check` runs the complete dependency audit, including development
packages, at every severity. CI runs it together with the license and Prisma
tooling checks. Network/audit-service errors fail the command; a successful
snapshot does not guarantee absence of undisclosed vulnerabilities.

## Production separation

The backend Dockerfile installs the API/worker/backend/config runtime graph into
a fresh stage with `--prod --no-optional --frozen-lockfile`. Optional dependencies
are excluded because Prisma Client records CLI and TypeScript as optional peers.
The runtime uses the JavaScript PostgreSQL driver and Argon2's bundled native
binding; it does not require optional pg-native or Cloudflare transports.

Only that dependency store is copied into the final API/worker/migration image.
`check-runtime-dependencies.mjs` checks the physical store during the image build,
including unreachable files, rejecting development tooling and unapproved
licenses. The frontend image continues to contain only built static assets.

## FND-04 status

The license approval is resolved. The CLI is available for schema/client work.
`prisma:check` validates and generates the existing model into a disposable
directory without modifying committed generated files. `prisma:generate` is the
explicit command to update those files once schema changes are ready.

This maintenance step does not complete Auth model introspection/drift checks,
Owner bootstrap, sessions, invitations, role policies, rate limiting, audit or
the authentication API/UI. Those remain the unchecked FND-04 tasks. Kysely is
still the only migration authority; Prisma Migrate is not used in deployment.
