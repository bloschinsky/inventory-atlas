# Module boundaries

`pnpm boundaries:check` is the executable boundary policy. It scans JavaScript, TypeScript, and Vue sources and tests itself against committed positive and negative fixtures.

## Backend

- Applications consume `@inventory-atlas/backend` through its exported public surface.
- Deep imports such as `@inventory-atlas/backend/modules/...` are forbidden.
- Each future backend module exposes deliberate types and behavior from `modules/<module>/index.ts`; internal domain, application, port, adapter, API, and job files are not cross-module APIs.
- HTTP and worker composition roots wire modules but do not contain domain or repository logic.

## Frontend

- `shared` cannot import `entities`, `features`, `pages`, or `app`.
- `entities` can import only `shared`.
- `features` can import `entities` and `shared`.
- `pages` compose features and may import `entities` and `shared`.
- PrimeVue and PrimeUIX imports are permitted only in `packages/ui`. Application code imports the semantic `App*` facade through `apps/web/src/shared/ui`.

Any facade exception needs a documented gap and removal plan. FND-01 has no open facade gaps.
