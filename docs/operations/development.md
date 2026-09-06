# Development setup

## Docker is the supported development environment

The host needs Docker with Compose v2, a checkout, and an editor. On Windows use
Docker Desktop with Linux containers. Node, Corepack, pnpm, PostgreSQL and
Playwright browsers run inside containers; do not install or change host Node
to work on this repository. Git is needed to obtain and commit the checkout.

From the repository root:

```bash
docker compose -f compose.dev.yml up --build dev
```

Open http://localhost:5173. The first build downloads the pinned Node/pnpm
toolchain, dependencies and Chromium. Installation completes before Kysely
migrations and the API/Vite watchers start. Vite proxies `/api` and `/health` to
the API so browser requests remain same-origin. Save source files in your normal
editor: Vue hot reloads and the API watcher restarts. Polling is enabled for
Docker Desktop bind mounts.

This standalone Compose project uses its own PostgreSQL and media volumes,
separate from the compact deployment. Neither database publishes a host port.
The development database uses synthetic local credentials and `.env.example`
defaults; it does not require a production `.env`. Only the web development port
is published, on loopback. Change development overrides in `compose.dev.yml`.

The checkout is mounted at `/workspace`. Every workspace `node_modules` directory
is overlaid with a Docker volume; Windows dependencies never become Linux
dependencies. Generated source, lockfile edits, build output and test reports
are written back to the checkout. On Linux the default container UID is 1000;
use a checkout writable by that UID. Adding a new workspace also requires adding
its dependency volume and image directory alongside the existing ones.

## Commands and verification

Use the same root pnpm commands, inside the `tools` service:

```bash
docker compose -f compose.dev.yml run --rm tools pnpm lint
docker compose -f compose.dev.yml run --rm tools pnpm check
docker compose -f compose.dev.yml run --rm tools pnpm test
docker compose -f compose.dev.yml run --rm tools pnpm build
docker compose -f compose.dev.yml run --rm tools pnpm test:integration
docker compose -f compose.dev.yml run --rm tools pnpm db:verify
docker compose -f compose.dev.yml run --rm tools pnpm contracts:check
docker compose -f compose.dev.yml run --rm tools pnpm i18n:check
docker compose -f compose.dev.yml run --rm tools pnpm license:check
docker compose -f compose.dev.yml run --rm tools pnpm format:check
docker compose -f compose.dev.yml run --rm tools pnpm test:e2e
```

Run the build before E2E (Playwright serves the built frontend). Run development
startup/migrations before `db:verify`. Integration tests receive
`INTEGRATION_DATABASE_URL` pointing to `test-db`, a separate real PostgreSQL
database. They must execute, not be reported as skipped. The current E2E suite
tests the frontend shell; future authenticated E2E scenarios need API fixtures.

For formatting or contract generation, replace the final command with
`pnpm format` or `pnpm contracts:generate`. For an interactive container shell:

```bash
docker compose -f compose.dev.yml run --rm tools sh
```

Stop `dev` before changing dependencies. Run the appropriate `pnpm add` command
through `tools` (for example, `pnpm --filter @inventory-atlas/web add <package>`).
Manifest and lockfile changes reach the host; dependency files stay in volumes.
Then rebuild and restart `dev`. `install` uses the frozen lockfile on startup.
When Playwright changes, rebuilding also installs its matching browser version.
Prisma client regeneration remains subject to the existing CLI license review;
containerization does not resolve that dependency-policy issue.

## Compose checks from containers

The scripts that themselves call Docker use a separate, opt-in service:

```bash
docker compose -f compose.dev.yml run --rm docker-tools node scripts/validate-compose.mjs
docker compose -f compose.dev.yml run --rm docker-tools node scripts/test-compose-persistence.mjs
```

`docker-tools` contains Docker CLI, Buildx and Compose and mounts the host Docker
socket. This grants control of the host daemon; use it only for these trusted
repository scripts. It does not run another Docker daemon. Ordinary `dev` and
`tools` containers have no socket access. Docker client tools are installed from
Docker's official Debian repository when the development image is built; record
their versions with the FND-02 validation results.

The persistence drill builds a separate compact project with random loopback
ports, checks database and media contents across recreation, and removes only
that disposable project's volumes. The compact Caddy configuration is baked into
its image so this nested CLI does not depend on host bind-mount path translation.

## Stop and restart

```bash
docker compose -f compose.dev.yml down
docker compose -f compose.dev.yml up --build dev
```

`down` preserves named volumes. Do not add `--volumes` unless intentionally
discarding development databases, media and dependency caches. Stop the dev
service before reinstalling shared dependencies.

## Compact deployment

For the production-style graph, copy `.env.example` to `.env`, replace the
example secrets, and run:

```bash
docker compose up --build
```

Open http://localhost. This graph serves a built application and does not use hot
reload. Its configuration, settings authority and persistent volumes remain
independent of `compose.dev.yml`. The older `infra/compose/development.yml` is
only a compact diagnostic override; it is not the development workflow.

## Validation status

Validated on the Windows reference host on 2026-09-06. A clean container build,
ordered compact and development startup, API restart, Vue HMR, isolated
dependency volumes, real-PostgreSQL integration, Playwright, Compose validation,
and database/media persistence across forced container recreation all passed.
The host used Docker Desktop 4.89.0, Engine 29.7.2 and Compose 5.5.0. The pinned
`docker-tools` image provided Docker CLI 29.8.0 and Compose 5.5.1.
