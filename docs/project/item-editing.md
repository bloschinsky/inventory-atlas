# Item editing with optimistic concurrency

CAT-04 makes an Item aggregate editable without letting one editor silently
overwrite another. The API gains a versioned `PATCH /api/v1/items/{publicId}`
and the visibility-aware `GET /api/v1/items/{publicId}` the edit workflow reads
from. Both carry the aggregate version as an `ETag`.

## Expected version is mandatory

Every update states the version it was built on. `If-Match` and the body field
`expectedVersion` are both accepted; when both are present they must agree, and
`IF_MATCH_MISMATCH` rejects a request that disagrees with itself. A missing or
non-positive version fails contract validation before the service is reached.

The version is enforced inside the transaction by a compare-and-swap on
`items.version`:

```sql
update items set ..., version = version + 1
  where id = $1 and version = $expected and archived_at is null
```

A row count of zero means either the Item disappeared or another editor already
advanced it. The service re-reads the row and answers with the conflict payload,
so a lost race is never mistaken for a successful write. The version increments
for a core column change and for a typed attribute change alike; both are
aggregate mutations.

## One transaction, one client

The update follows blueprint section 9.1 and holds a single Prisma interactive
transaction for the source row, the typed values written through
`AttributeValuePort`, the synchronous `item_search` projection, the audit event,
the movement record when the storage destination changes, the outbox message and
the idempotency completion. Any port failure rolls all of them back together;
the integration suite asserts that a failing outbox leaves the Item at its old
version with its old values.

`Idempotency-Key` is optional on an update: the expected version already makes a
blind retry safe. When a key is supplied, a retried identical request replays the
stored response instead of incrementing the version twice, and the same key with
a different request is a fingerprint conflict.

## Safe conflict payload

A rejected update answers `409` with `ITEM_VERSION_CONFLICT`, the current
version, and a `safeDiff`:

```json
{
  "code": "ITEM_VERSION_CONFLICT",
  "currentVersion": 4,
  "safeDiff": {
    "displayName": { "current": "Cordless drill (workshop)", "submitted": "Cordless drill mk2" },
    "attributes.serial_number": { "current": "SN-99", "submitted": "SN-43" }
  }
}
```

The diff contains only fields the rejected actor may view. A field definition
with `visibility = private` is excluded for an actor without
`viewPrivateFields`, so a conflict cannot become a private-value oracle. The same
rule governs the read endpoint, and a `private` Item is reported as missing
rather than forbidden so its existence does not leak.

Privacy also constrains the write path. `AttributeValuePort.replace` rewrites the
whole owner value set, so the service merges the submission over the stored
values and keeps every value whose definition the actor cannot see. An Editor
saving a form that never showed the private field therefore cannot erase it.
Values whose definition no longer applies after a category change are dropped,
which is the intended effect of moving an Item to another category.

## Registered invalidators

`packages/backend/src/catalog/item-invalidation.ts` holds the Item-scoped rows of
the search invalidation registry (blueprint section 9.4, ADR-017). The mutation
path does not decide invalidation itself; it reports what changed and the
registry returns the events:

| Signal | Registered event | Synchronous obligation |
| --- | --- | --- |
| Typed value or projected core column changed | `AttributeChanged` | Entire `item_search` row |
| Effective visibility changed | `ItemVisibilityChanged` | Visibility and all public projections |
| Item created | `ItemCreated` | Entire `item_search` row |

Every Item-scoped row is fully synchronous, so no asynchronous rebuild leaves the
transaction. The fired events travel in the `catalog.item-updated.v1` outbox
payload and in the update response, which lets a consumer and a test observe
exactly which registry rows a change triggered.

## Conflict-aware editing

`/items/:publicId/edit` loads the Item, sends the loaded version, and never
retries on its own. A conflict replaces the form with the compare/reload/abandon
workflow required by blueprint section 11.2:

- **Compare** renders the safe diff with the saved value beside the unsaved one.
- **Reload** re-reads the winning version and resets the form to it.
- **Discard** leaves the editor for the Item card.

None of the three resubmits automatically. To keep a rejected change the editor
reloads the saved version and re-applies the edit on top of it, which produces a
new request against the current version rather than an overwrite of an unseen
one.
