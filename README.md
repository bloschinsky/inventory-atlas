```text
┌──────────────────────────────────────────────────────────────┐
│  ██╗ █████╗                                                  │
│  ██║██╔══██╗   INVENTORY ATLAS                               │
│  ██║███████║   KNOW WHAT YOU OWN. KNOW WHERE IT IS.          │
│  ██║██╔══██║                                                 │
│  ██║██║  ██║                                                 │
│  ╚═╝╚═╝  ╚═╝                                                 │
└──────────────────────────────────────────────────────────────┘
```

# Inventory Atlas

Inventory Atlas is a self-hosted system for cataloging personal or organizational property and tracking exactly where it is stored.

It is designed for collections that outgrow spreadsheets: Items can have configurable typed fields, photos, nested storage locations, searchable metadata, printable QR or barcode labels, and portable backups.

## What it solves

- Find an Item by any permitted field.
- See its complete location, such as `Warehouse -> Box -> Case`.
- Model storage containers at arbitrary depth.
- Add custom typed fields without changing application code.
- Label and scan Items or containers from a phone.
- Keep private fields and exact storage paths protected.
- Move the complete installation, including media, through export/import.

## Technology

- Vue 3, Vite, modern JavaScript, Vue Query, and Pinia.
- PrimeVue behind an internal semantic UI facade.
- Node.js 24 LTS, NestJS, TypeScript, and Fastify.
- PostgreSQL with Prisma and Kysely under explicit ownership rules.
- Docker Compose for local, homelab, and dedicated-server deployment.

The MVP has no mandatory Redis, external search engine, message broker, or S3 service.

## Status

Implementation is in progress. FND-01 provides the pinned monorepo, stable root commands, application composition roots, frontend shell, and UI facade.

Current development version: **`0.1.0-dev.1`**.

First release target: **`0.1.0` Technical Demo**.

## Versioning

Before `1.0.0`:

- A completed feature step increments the middle number: `0.1.0` -> `0.2.0`.
- Small fixes and maintenance increment the last number: `0.1.0` -> `0.1.1`.
- Development builds may use `0.1.0-dev.N`.
- `1.0.0` is reserved for the complete stable MVP.

See the [versioning policy](docs/project/versioning.md) for the full policy.

## Project documents

- [Implementation blueprint](IMPLEMENTATION-BLUEPRINT.md)
- [Implementation roadmap](TODO-ROADMAP.md)
- [Documentation index](docs/README.md)
- [Product design](docs/product/inventory-atlas-design-document-v0.3.1.pdf)
- [Versioning policy](docs/project/versioning.md)
- [Agent instructions](AGENTS.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Root commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm check
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm db:migrate
pnpm db:seed
pnpm db:verify
pnpm api:spec
pnpm contracts:generate
pnpm contracts:check
pnpm i18n:check
pnpm compose:validate
```
