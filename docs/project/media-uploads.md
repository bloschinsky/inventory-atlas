# Media uploads and attachments

MED-01 delivers the shared media model, the storage adapter boundary, and the complete Item
media flow. Kysely migration `0007_media` owns `media_assets`, `media_relations` and
`upload_sessions`; the Media module writes all three through Prisma.

Image decoding is not part of this step. Finalize enqueues `media.process-asset.v1`, and MED-02
consumes it in an isolated child process to strip metadata, fix orientation and build variants.
Until then an asset stays in `processing_state = 'pending'` and the original bytes are served.

## Three-step upload

| Step | Endpoint | What it establishes |
| --- | --- | --- |
| Declare | `POST /api/v1/media/upload-sessions` | Authorization, filename, media type, byte size, expiry |
| Send | `PUT /api/v1/media/upload-sessions/{id}/content` | The bytes, their real size and their checksum |
| Finalize | `POST /api/v1/media/upload-sessions/{id}/finalize` | The verified asset, its relation and the processing message |

The declaration is checked before any byte is accepted: only JPEG, PNG, WebP and HEIC are
allowed, the filename extension must agree with the declared type, the filename is reduced to a
safe base name with no directory component or control character, and the declared size must fit
`MEDIA_MAX_UPLOAD_BYTES`. A session is authorized for one actor and one Item and expires after
fifteen minutes.

The content request streams straight into temporary storage while the adapter counts bytes and
computes the SHA-256. The ceiling is enforced *during* the write, so an oversized upload is
aborted mid-stream and its partial object is removed rather than landing on disk in full.

Finalize is the gate that creates state. It verifies that the received size equals the declared
size, that the caller's checksum (when supplied) equals the computed one, and that the file
header is a recognized signature that matches the declared type — a `.jpg` carrying a GIF or an
SVG is rejected here. Only then is the object promoted to its permanent key and, in one Prisma
transaction, the asset row, the relation, the session completion, the audit event and the
`media.process-asset.v1` message are written together. If that transaction fails the promoted
object is removed again, so storage never holds bytes no row references.

A failed check moves the session to `failed` with the stable code and deletes the temporary
object, so a rejected upload leaves nothing behind.

### Transport deviation

Blueprint section 12.1 describes the local-mode upload as multipart. The content endpoint takes
the raw object with `application/octet-stream` instead: the session already carries the filename,
media type and size, so the multipart envelope would add a runtime dependency and a parsing layer
without carrying any information. This was agreed with the project owner. Presigned S3 uploads,
when the S3 adapter arrives, are unaffected because they never pass through the API.

## Relations, primary image and ordering

A relation links one asset to exactly one owner and carries `role`, `position`, `alt_text` and
`visibility`. Partial unique indexes enforce the invariants in the database, not only in code:

- one active `primary` per owner,
- one active relation per owner, role and position,
- one active relation per asset and owner.

Attaching a new primary demotes the previous one to the gallery. Promoting a gallery image does
the same in reverse. Both rewrite positions in two passes inside the transaction — the affected
rows are parked above the used range first — so the position uniqueness index is never violated
mid-transaction.

Reorder takes the whole active gallery as one ordered list and rewrites it as a contiguous run
from zero. A partial list, a duplicate or an unknown relation is rejected, so ordering cannot
drift into gaps or collisions.

## Optimistic concurrency

`PATCH /media/relations/reorder`, `POST /media/relations/{id}/primary` and
`DELETE /media/relations/{id}` all state the Item version the client saw — in the body for
reorder, as `If-Match` for the other two. A stale value is rejected with
`MEDIA_OWNER_VERSION_CONFLICT` and the current version, the same shape CAT-04 uses.

The version is a precondition, not a counter the Media module advances: Catalog owns `items`, so
Media reads the owner through `MediaOwnerPort` and never writes that table.

## Visibility

A relation's visibility is independent of the Item's. A `private` image is withheld from an actor
without `viewPrivateFields` in both the listing and the byte-serving endpoint, and a `private`
Item hides its media entirely. Served bytes carry `X-Content-Type-Options: nosniff`, an explicit
`Content-Type`, and an immutable cache policy — a new upload always produces a new asset id, so a
stored object never changes.

## Placeholders

An Item with no visible media keeps the CAT-03 category placeholder: the card renders the
category initial instead of an image, and the media manager says so explicitly. The first image
attached to an Item becomes its primary automatically.

## Delayed cleanup

Detaching archives the relation and sets `media_assets.delete_after` to twenty-four hours ahead;
it never deletes bytes inline. `MediaService.collectOrphans` is the reclaim pass:

1. Select assets whose `delete_after` has passed.
2. Recheck live references. An asset that gained an active relation again is retained and its
   schedule cleared.
3. Delete the row conditionally, inside a transaction that counts active relations once more, so
   a re-attachment racing the cleanup cannot lose a referenced asset.
4. Only after the row is gone are the bytes removed.

`MediaService.expireSessions` performs the same reclaim for abandoned upload sessions. Both are
plain service methods with integration coverage; the Jobs module will schedule them when it
lands, which is why neither assumes a worker exists.

## Storage adapters

`MediaStoragePort` is the only byte-level contract: `writeTemp`, `promote`, `openRead`, `exists`
and `remove`. `LocalMediaStorage` is the default and the only mandatory driver. Keys are
server-generated and content-addressed (`assets/<aa>/<bb>/<id>.<ext>`), an unrecognized extension
is dropped rather than trusted, and the adapter refuses any key that would resolve outside its
root. An S3-compatible adapter implements the same port without changing a caller; S3 stays
optional and is not required by the MVP.

## Deferred to STO-01

The shared model already supports StorageNode owners: `media_relations.storage_node_id`, the
`container_photo` role and the node-side unique indexes exist. The foreign key, node
authorization, UI wiring and node integration tests wait for STO-01 to create the
`storage_nodes` table, exactly as `items.storage_node_id` already does.
