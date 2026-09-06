# Compose deployment

For daily development use the standalone root `compose.dev.yml`; see
`docs/operations/development.md`. `development.yml` below only enables diagnostics
on the compact graph and does not provide hot reload.

The root `docker-compose.yml` is the compact production graph. Copy
`.env.example` to `.env`, replace the example database and session secrets, then
start it with:

```bash
docker compose up --build
```

Only Caddy publishes a host port. PostgreSQL, migration, API, and static web
services communicate through the internal `backend` network. Named volumes
preserve PostgreSQL, media, and Caddy data across container recreation.

Development, expanded runner, backup, restore, and test profiles are delivered
as checked-in overrides/profiles:

```bash
docker compose -f docker-compose.yml -f infra/compose/development.yml up --build
docker compose -f docker-compose.yml -f infra/compose/expanded.yml --profile expanded up --build
docker compose --profile backup run --rm backup
docker compose --profile restore run --rm -e ALLOW_RESTORE=yes -e RESTORE_FILE=<file> restore
docker compose -f docker-compose.yml -f infra/compose/test.yml up --build
```

Restore refuses to run without both the explicit allow flag and a dump filename.
`pnpm compose:validate` resolves every graph through Docker Compose, and
`pnpm test:compose:persistence` performs an isolated database/media recreation drill.
