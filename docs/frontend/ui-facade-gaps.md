# UI facade gaps

PrimeVue and PrimeUIX are isolated in `packages/ui`. Domain pages, features, and entities consume the 18 semantic `App*` components through `apps/web/src/shared/ui`.

| Status | Owner | Reason | Affected route | Replacement target | Due stage |
| --- | --- | --- | --- | --- | --- |
| None | — | No open facade gaps | — | — | — |

An open entry uses `OPEN` in the Status column. `pnpm check` fails while one exists.
