# Localization foundation

English (`en`) is the source, startup default, and runtime fallback. Ukrainian
(`uk`) is required for every key listed by `packages/i18n/src/mvp.json`.
Browser preferences may annotate Ukrainian as suggested, but never participate
in automatic locale resolution.

Keys use stable dotted names in the form `area.concept` or
`area.concept.state`. Segments start with a lowercase letter and use camelCase;
they describe meaning rather than rendered English. User IDs, database keys,
and translated words must never be interpolated into a translation key.

Resolution follows explicit choice, persisted preference, then English. The web
client stores the anonymous preference under `inventory-atlas.locale`. Once a
session is available, `users.locale` is authoritative and a selector change is
persisted through `PATCH /api/v1/auth/me/locale`. The client renders API failure
categories through local `problems.*` keys rather than displaying server prose.

Vue I18n owns message fallback and locale-aware date and number formatting.
Changing locale also updates the document `lang` attribute. User-entered content
is displayed unchanged and is never machine-translated.

Run `pnpm i18n:check` to validate stable English keys, reject target-only keys,
expand MVP manifest patterns, and fail on missing or empty Ukrainian MVP values.

Verification for this increment passed formatting, lint, type and boundary checks,
contract drift, build, schema verification, and Compose validation. All 68 unit
tests, 47 real-PostgreSQL integration tests, and five Playwright scenarios pass;
the coverage gate reports 78 translated MVP keys.
