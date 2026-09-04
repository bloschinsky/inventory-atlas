# Reference and acceptance fixtures

This directory holds the versioned reference and acceptance datasets from
blueprint section 5. Fixtures are the frozen inputs that later stories load into
a real PostgreSQL database, media storage, and the label renderer to prove the
approved acceptance criteria. Nothing here changes product scope; these are
inputs, not new behavior.

## Layout

| Path | Purpose | First consuming story |
| --- | --- | --- |
| `catalog/categories-fields.en-uk.json` | Representative bilingual categories, lifecycle statuses, and typed field definitions/options. | CAT-01, CAT-02 |
| `storage/tree-fixtures.json` | Storage-tree shapes including an eight-level subtree and cross-root move cases. | STO-01, STO-02 |
| `media/` | Known JPEG, PNG, WebP, and HEIC capability fixtures plus their manifest and generator. | MED-02 |
| `labels/` | Printable A4-grid and 50x30 mm label proofs rendered at actual physical size. | LAB-02 |

## Conventions

- English is the source locale; every user-facing label also carries a complete
  Ukrainian value, matching the required MVP locale.
- Stable keys (`key`, `stableKey`, `publicId`) never change when labels change,
  as required by CAT-01/CAT-03 acceptance criteria.
- Identifiers in JSON fixtures are stable, human-readable placeholders. Stories
  that load a fixture map these placeholders to real UUID public IDs and
  lowercase UUID-hex `ltree` labels; the fixtures never hardcode a generated
  database UUID.
- Binary media fixtures are small, deterministic, and checksum-pinned in
  `media/manifest.json`.

## Performance acceptance dataset

The 100,000-Item performance dataset from blueprint section 20.3 is generated,
not committed as a large binary. Its shape (100k Items, 1,000 storage nodes with
at least one eight-level subtree, 30 field definitions, 10-20 attribute values
per average Item, mixed English/Ukrainian labels) and the warm-homelab targets
are recorded in [`docs/project/reference-hardware.md`](../../docs/project/reference-hardware.md).
The generator itself is delivered with SRCH-02, which owns the 100k acceptance
suite. The fixtures in this directory are the small, review-friendly seeds that
that generator scales up from.
