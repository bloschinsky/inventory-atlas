# Display-name templates

CAT-05 turns `categories.display_template` from free text into a closed token
grammar and makes `items.display_name` a derived, cached value. One renderer in
the Schema module serves the Admin preview and the Item mutation path, so a
preview can never disagree with what is stored.

## Grammar

A template is literal text interleaved with `{{stable_key}}` tokens:

```text
{{category}} {{brand}} {{model}} - {{condition}}
```

It is a substitution language, not an expression language. There is no loop, no
conditional, no property path, no function call, and no way to reach a value the
resolver was not given. `parseDisplayTemplate` enforces the structure:

- A token name matches `^[a-z][a-z0-9_]{0,63}$`; surrounding spaces inside the
  braces are allowed and normalized. `{{item.brand}}` and `{{Brand}}` are
  rejected.
- Literal text may not contain `<`, `>`, `&`, `` ` ``, `$`, `\`, `|`, a stray
  brace, or a control character. `{% … %}` and `{{#each}}` therefore fail as
  invalid tokens or forbidden characters.
- A template carries at least one token, at most 12, and at most 500 characters.

`validateDisplayTemplate` then resolves the tokens against the category's active
item-scoped fields. Every failure reports a stable code, and the Admin editor
localizes the code rather than showing API prose:

| Code | Meaning |
| --- | --- |
| `TEMPLATE_UNKNOWN_TOKEN` | No active field of this category owns the key |
| `TEMPLATE_PRIVATE_TOKEN` | The field is `private` |
| `TEMPLATE_UNSUPPORTED_TOKEN_TYPE` | The data type has no deterministic text form |
| `TEMPLATE_FORBIDDEN_CHARACTER`, `TEMPLATE_INVALID_TOKEN`, `TEMPLATE_UNTERMINATED_TOKEN` | Grammar violations |
| `TEMPLATE_EMPTY`, `TEMPLATE_NO_TOKEN`, `TEMPLATE_TOO_LONG`, `TEMPLATE_TOO_MANY_TOKENS` | Size and shape violations |

### Approved tokens

Core tokens are `category` and `status`; both resolve to the dictionary label.
Every other token is an item-scoped field key applicable to the category.

A `private` field is refused rather than skipped at render time, because the
rendered name reaches public projections, cards, labels and search vectors — a
private value must never be able to enter it.

`boolean` and `reference` are refused as well: a boolean would render as a word
that depends on the viewer's locale, and a reference renders as an opaque
identifier. Every other approved data type renders deterministically — text as
its trimmed value, `number` as its canonical decimal, `date`/`datetime` as their
canonical ISO form, `money` as `amount CURRENCY`, and `select`/`multiselect` as
the localized option labels joined by `, `.

## Deterministic rendering

`renderDisplayName` is pure: the same template and the same values always
produce the same string.

1. Each token resolves to its value or to the empty string when it is missing.
2. A missing token is skipped. A literal run made only of whitespace and
   separator punctuation is dropped unless rendered content survives on both
   sides of it, so `{{brand}} - {{model}}` with no brand renders `LX`, not
   `- LX`. A literal containing real words is always kept.
3. Whitespace runs collapse to one space and the result is trimmed of leading
   and trailing separators.
4. The result is truncated at 200 characters and trimmed again, so truncation
   never leaves a dangling dash.

The cached column stores one string, so it renders in the source locale
(English). The preview returns both `en` and `uk` from the same renderer, which
is how a template that mixes localized option labels with user values can be
checked before it is saved.

## Derivation and fallback

A category without a template keeps the name the actor typed — this is the
mobile quick-add path. A category with a template derives the name inside the
Item transaction (blueprint section 9.1 step 7), from the merged attribute values
that same transaction is about to write. If the template resolves to nothing, the
typed name is kept rather than storing an empty column, and a stored template
that no longer parses falls back the same way instead of blocking the mutation.

Deriving the name changes only `items.display_name`, the slug of a *new* Item,
and the projection text. `public_id` is immutable, an existing Item's slug is
never rewritten, and no issued code is touched; the CAT-04 integration suite
asserts the identity columns are byte-identical across a rename.

## Recompute

| Change | Effect |
| --- | --- |
| An Item attribute or core column changes | The name is re-derived inside the same transaction and the `AttributeChanged` registry row rewrites the projection |
| A category template changes | The category update enqueues `search.rebuild-items.v1` so the category's Items are rebuilt asynchronously |

The template change reuses the existing `CategoryRenamed` row of the blueprint
section 9.4 registry rather than introducing a ninth invalidator event: from the
projection's standpoint both changes require the same work on the same Item set.
The payload carries `reasons` (`labels`, `display_template`) and
`rebuildsDisplayNames` so a consumer and the audit trail can tell them apart.

## Preview surface

`POST /api/v1/categories/{id}/display-name-preview` accepts a candidate template
and optional sample values keyed by stable field key, and returns the resolved
tokens, the rendered `en`/`uk` output, and the tokens that had no sample value.
It requires `manageSchema` and the session CSRF token, and it validates the
template exactly as saving does, so the editor reports a rejection before the
category is written.

The `/admin/categories` editor inserts tokens by clicking a field, offers a
sample-value input for each token the draft uses, and renders the live preview.
A private field is never offered. Preview needs a persisted category, so a brand
new category shows the token list and previews once it is saved.

## Not in this step

The approved design document allows a template to be set "globally or per
category". Only the per-category template is implemented: the blueprint schema
places `display_template` on `categories`, and a global default belongs in
`app_settings`, which has no administration API or UI yet. The global default
should be delivered with the settings-management surface.
