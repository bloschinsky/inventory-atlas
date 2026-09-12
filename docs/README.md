# Inventory Atlas documentation

This directory contains supporting product, architecture, API, operations, security, and project documentation. Repository-level entry points and working contracts remain in the repository root.

## Core documents

- [Project overview](../README.md)
- [Implementation blueprint](../IMPLEMENTATION-BLUEPRINT.md)
- [Implementation roadmap](../TODO-ROADMAP.md)
- [Architecture decision records](adr/README.md)
- [Contributing guide](../CONTRIBUTING.md)
- [Security policy](../SECURITY.md)
- [Changelog](../CHANGELOG.md)

## Product

- [Approved product design v0.3.1](product/inventory-atlas-design-document-v0.3.1.pdf)

## Project policies

- [Versioning and release procedure](project/versioning.md)
- [Documentation follow-up fixes for Blueprint/Roadmap v0.3.1](project/INVENTORY-ATLAS-DOCUMENTATION-FOLLOWUP-FIXES.md)
- [Validation-release scope-simplification audit](project/mvp-scope-simplification-audit.md)
- [Validation-release scope and sequencing change request v2](project/inventory-atlas-mvp-scope-simplification-task-v2.md)
- [Toolchain baseline and update policy](project/toolchain.md)
- [Initial dependencies and license review](project/dependencies.md)
- [Browser support baseline](project/browser-support.md)
- [Reference hardware and performance dataset profile](project/reference-hardware.md)
- [Physical label test matrix](project/physical-label-matrix.md)
- [Stage 1 implementation handoff](project/stage-1-handoff.md)
- [Module boundary policy](project/module-boundaries.md)
- [Localization foundation](project/localization.md)
- [Catalog dictionary foundation](project/catalog-dictionaries.md)
- [Dynamic field schema and typed EAV](project/dynamic-schema.md)
- [Media uploads and attachments](project/media-uploads.md)
- [Image processing and background jobs](project/media-processing.md)
- [Development setup](operations/development.md)
- [Transitive dependency license report](project/third-party-licenses.json)
- [UI facade contracts](frontend/ui-facade-contracts.md)
- [UI facade gaps](frontend/ui-facade-gaps.md)

## Reference and acceptance fixtures

- [Fixtures overview](../db/fixtures/README.md)
- [Bilingual catalog and field fixtures](../db/fixtures/catalog/categories-fields.en-uk.json)
- [Storage tree fixtures](../db/fixtures/storage/tree-fixtures.json)
- [Media capability fixtures](../db/fixtures/media/README.md)
- [Label proofs (A4 grid and 50x30 mm)](../db/fixtures/labels/README.md)

## API, operations, and security

- [REST and OpenAPI blueprint](../IMPLEMENTATION-BLUEPRINT.md#10-rest-and-openapi-blueprint)
- [Docker and deployment blueprint](../IMPLEMENTATION-BLUEPRINT.md#17-docker-and-deployment-blueprint)
- [Observability and operations blueprint](../IMPLEMENTATION-BLUEPRINT.md#19-observability-and-operations)
- [Security policy](../SECURITY.md)
- [Authentication, authorization, and security blueprint](../IMPLEMENTATION-BLUEPRINT.md#16-authentication-authorization-and-security)

Generated API references and implementation runbooks will be indexed here as
their owning roadmap stories produce them.

## Decision governance

The approved product design is authoritative over the implementation blueprint.
If the blueprint and product design conflict, implementation stops until an ADR
resolves the conflict. An accepted ADR is superseded by adding a new ADR, never
by silently rewriting the existing record.

## Planned sections

- `api/` — generated and explanatory API documentation.
- `operations/` — deployment, backup, restore, and runbooks.
- `security/` — detailed security design and operational guidance.
- `frontend/` — frontend implementation notes and facade-gap tracking.
