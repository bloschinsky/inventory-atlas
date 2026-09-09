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

CAT-01B still owns the application services, REST/OpenAPI contracts, authorization,
and bilingual Admin UI. CAT-01C owns complete Item history resolution plus audit
and search-invalidation behavior.
