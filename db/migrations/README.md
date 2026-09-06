# Migrations

Kysely is the sole migration authority. `0001_foundation.mjs` creates the typed
installation-setting store required by FND-02. Run all pending migrations with
`pnpm db:migrate`; deployment runs the same migration code in the one-shot
`migrate` container before starting the API.
