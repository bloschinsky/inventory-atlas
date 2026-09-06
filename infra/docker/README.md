# Docker images

`backend.Dockerfile` builds the shared backend once and exposes `api`, `worker`,
and one-shot `migrate` targets. `web.Dockerfile` builds the Vue application and
serves the static bundle with Caddy. Runtime stages use numeric/non-root users,
and Compose supplies only the explicitly writable paths.

The Node, PostgreSQL, and Caddy base references use exact version tags and
multi-platform index digests. Update the tag and digest together under the
toolchain update policy.

`development.Dockerfile` supplies the Docker-only development/test toolchain,
including the lockfile-matched Playwright Chromium browser. It is used by
`compose.dev.yml`; see `docs/operations/development.md` for commands and the
pending runtime validation gate. Docker client packages come from the official
Debian repository; record their installed versions during validation.

`caddy.Dockerfile` includes the gateway configuration in its image. Rebuild the
gateway after changing `infra/caddy/Caddyfile`; no host configuration bind mount
is needed when Compose is driven from the tools container.
