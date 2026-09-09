# Catalog dictionary foundation

CAT-01A introduces the persistence and policy boundary for categories and
lifecycle statuses. Kysely migration `0003_catalog_dictionaries` owns the tables,
constraints, indexes, immutable-key triggers, and category-cycle trigger. Prisma
owns normal dictionary reads and writes through `CatalogDictionaryRepository`.

## Dictionary rules

- Stable keys use lower-case letters, digits, and underscores, start with a
  letter, and never change after creation.
- `label_i18n` contains only `en` and optional `uk`. English is non-empty and
  required; Ukrainian is non-empty when supplied.
- Active lists sort by `display_order` and then stable key. Display order is a
  non-negative integer.
- Mutable rows start at version 1. Repository updates and archives require the
  expected version and increment it once.
- Archive operations set `archived_at` rather than deleting rows. Repository
  key lookups include archived rows by default so later Item history can resolve
  them; active list queries exclude them by default.
- A category parent must exist, be active, and lie outside the category's own
  subtree. PostgreSQL also rejects cycles created outside the repository.

## Lifecycle seed

`pnpm db:seed` inserts `stored`, `reserved`, `lent`, `for_sale`, `sold`, `lost`,
and `archived` with English and Ukrainian labels and semantic color tokens. Fixed
UUIDs make the initial identities deterministic. `createMany(skipDuplicates)`
means rerunning the seed adds only missing keys and never overwrites administrator
changes.

## Admin application and REST surface

CAT-01B adds `CatalogDictionaryService` as the Catalog module's application
surface. Active dictionary reads require an authenticated viewer; archived reads
and every mutation require `manageSchema`. Mutations also require the session's
CSRF token. The `/api/v1/categories` and `/api/v1/lifecycle-statuses` resources
support ordered list, create, versioned update, and archive operations. The
normalized OpenAPI contract and generated TypeScript, JavaScript/JSDoc, SDK, and
Zod artifacts describe the same surface and carry one checksum.

The `/admin/categories` and `/admin/statuses` routes use the shared semantic
`App*` facade and Vue Query. Both pages display English and Ukrainian labels,
include archived records, preserve stable keys while editing, validate inputs,
and invalidate their dictionary query after successful mutations.

CAT-01C still owns complete Item history resolution plus transactional audit and
search-invalidation behavior.
