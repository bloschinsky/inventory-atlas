# Image processing and background jobs

MED-02 turns an uploaded image into safe, sized renditions without ever letting a decoder run
inside the API process. It also delivers the job foundation the rest of the MVP builds on:
Kysely migration `0008_jobs` owns the `jobs` table, and `OutboxDispatcher` is what finally turns
the `media.process-asset.v1` message MED-01 commits into work.

## Why decoding is a separate process

Image decoding is the largest untrusted-input surface in the product: an attacker controls every
byte, and the decoder is a large C/C++ library. Blueprint section 12.2 therefore forbids
decoding in the API process at all. The rule here is stronger than a sandbox inside Node — no
image library is loaded into the API or the worker process in the first place.

`ImageProcessorPort` is the only decoding contract. `ChildImageProcessor` implements it by
launching one short-lived `vipsheader` or `vips thumbnail` process per operation through a
resource-limit wrapper. The API sees a value: a probe result, a rendered file, or a classified
`ImageProcessingError`. It never sees a signal, a segfault or an allocation failure.

### Decoder choice

Blueprint section 12.2 names Sharp. Sharp's prebuilt binaries do not decode HEIC — HEVC is
excluded from them for patent-licensing reasons — and no released Sharp accepts a global libvips
old enough to ship in the pinned Debian base image, so "Sharp" and "HEIC fixtures pass
capability checks" cannot both hold without building libvips from source in every image.

The implementation therefore drives libvips through its command-line tools instead of the Sharp
binding. This was agreed with the project owner. It satisfies ADR-011 as written ("custom
libvips/libheif"): Debian's `libvips-tools` links libheif with the libde265 decoder, so all four
approved formats decode, and `VIPS_CONCURRENCY=1` applies the concurrency limit the blueprint
fixes for Sharp. It is also strictly safer than the named option, because no native image
binding is linked into a long-lived process at all. Swapping the implementation later changes
one class behind `ImageProcessorPort` and nothing else.

## Resource limits

Every limit in blueprint section 12.2 is enforced, and each one before the next becomes
reachable:

| Limit | Source | Where it applies |
| --- | --- | --- |
| Input bytes | `MEDIA_MAX_UPLOAD_BYTES` | Checked from the object size before a child is launched |
| Decoded pixels | `MEDIA_MAX_PIXELS` | Checked against the header, before any pixel is produced |
| Address space / RSS | `MEDIA_CHILD_RSS_MB` | `ulimit -v` in the wrapper, before `exec` |
| CPU time | `MEDIA_CHILD_TIMEOUT_MS` | `ulimit -t` in the wrapper |
| Wall-clock timeout | `MEDIA_CHILD_TIMEOUT_MS` | Parent `SIGKILL`; a child blocked on I/O burns no CPU time |
| Decoder concurrency | Fixed at 1 | `VIPS_CONCURRENCY=1` in the child environment |
| Job concurrency | Fixed at 1 per runner | Capped at the approved ceiling of 2 |

The wrapper also sets `ulimit -c 0`: a core dump of a decoder would contain decoded private
image data. The real command is passed to `/bin/sh` as positional arguments rather than
interpolated into the script, so no filename can be read as shell syntax.

## Failure classification

The only distinction that matters is whether a retry could ever help.

| Code | Retry? | Cause |
| --- | --- | --- |
| `MEDIA_INPUT_BYTES_EXCEEDED` | No | Object is larger than the configured upload limit |
| `MEDIA_PIXEL_LIMIT_EXCEEDED` | No | Decode bomb: header declares more pixels than allowed |
| `MEDIA_DECODE_UNSUPPORTED` | No | Bytes are not a decodable image in this deployment |
| `MEDIA_DECODE_FAILED` | No | Decoder rejected the image for another reason |
| `MEDIA_SOURCE_UNREADABLE` | Yes | Stored object missing or unreadable right now |
| `MEDIA_PROCESSOR_UNAVAILABLE` | Yes | No decoder in this image |
| `MEDIA_PROCESSING_TIMEOUT` | Yes | Child outlived its timeout and was killed |
| `MEDIA_PROCESSING_CHILD_CRASHED` | Yes | Child was killed by a signal, including an OOM kill |

A permanent failure marks `media_assets.processing_state = 'failed'` with the stable code and
sends the job straight to dead state. A retryable failure leaves the asset `pending` so the next
attempt can still succeed, and the job waits out the backoff. Only the code is stored — decoder
output can quote image content and never reaches a row or a log line.

## Variants and metadata policy

`thumb` (320 px), `card` (800 px) and `preview` (1600 px) are produced as WebP. A variant that
would only upscale the source is skipped, so a small image never costs three near-identical
objects; `thumb` is always produced. Aspect ratio is preserved and nothing is ever enlarged.

Each variant is a `media_assets` row with `source_asset_id` pointing at the original and the
variant name in `metadata_json`. Variants carry no relation of their own: authorization is
inherited from the source asset, so a private image cannot be read through its thumbnail. Keys
are deterministic (`assets/<aa>/<bb>/<id>-<variant>.webp`), so reprocessing overwrites its own
objects instead of accumulating a new set per attempt, and the variant rows are replaced inside
one transaction.

EXIF, XMP, IPTC and any embedded GPS location are removed from every derived image. An
inventory photograph taken at home must not publish where that home is. Orientation is the one
exception: it is applied to the pixels and then dropped, so a stored variant is upright without
carrying the tag that described it. The recorded asset dimensions are what a viewer sees, with
the quarter-turn orientations already swapped.

Only a `ready` asset advertises renditions. A pending or failed asset exposes an empty
`variants` array and a null `thumbnailUrl`, so a card never links a half-written image; the
original is served until processing completes.

## Startup capability checks

Both composition roots decode the four committed fixtures in `db/fixtures/media` at startup
through the same child processor, and log the failing format and code when one cannot be read.
`/health/ready` reports `mediaCapabilities`, cached for five minutes so a ten-second probe does
not spawn a decoder every ten seconds. The fixture list comes from `manifest.json`, so the
startup check and the fixture inventory cannot drift apart.

### HEVC distribution gate

Debian's libvips links libheif with the libde265 HEVC decoder, which is what makes the HEIC
capability check pass. ADR-011 and blueprint section 12.2 record that publishing a prebuilt
HEVC-enabled image to a public registry requires a separate distribution/licensing review. That
review is not part of this step and no conclusion about it is made here; it remains an open
engineering release gate, recorded in the dependency baseline.

## The job foundation

`jobs` is Kysely-only (blueprint section 8.10). No Prisma transaction claims, leases or
completes a job.

- **Claim** takes due rows of one type in priority then age order inside a short transaction
  using `for update skip locked`, setting worker ID, lease expiry, heartbeat and attempt.
  Work then executes *outside* that transaction.
- **Heartbeat** extends a live lease. A lost lease stops the work instead of letting two runners
  believe they own the same job.
- **Expired leases** — a killed runner — return to `retry_wait`, or to `dead` once the attempt
  budget is exhausted.
- **Backoff** is exponential with jitter and a per-type maximum. Half the window is guaranteed,
  so a retry is never an immediate hot loop, and the jitter stops a batch that failed together
  from retrying together.
- **Idempotency** is a unique key per job. Re-enqueueing wakes a waiting job and never creates a
  second one; a running or finished job is left exactly as it is.
- **Progress** documents are clamped in width, key length and value length, and nested
  structures are dropped, so a handler cannot grow an unbounded row.
- **Per-type concurrency** separates media, cleanup, reindex, label and portability work.

States are `queued`, `running`, `succeeded`, `retry_wait`, `dead` and `cancelled`. An Admin can
requeue a dead job and cancel a waiting one.

### Outbox dispatch

`OutboxDispatcher` selects unpublished messages whose topic has a route, and for each one opens
a short Kysely transaction that locks the row with `for update skip locked`, creates or wakes
the idempotent job, and marks the row published — together. A job is never created without the
message being marked, and a message is never marked without its job. A topic no stage routes
yet is simply not selected: it waits for the stage that owns it rather than failing. A dispatch
that throws records the failure on the message and retries under the same backoff.

## Compact and expanded profiles

`createMediaRuntime` and `createJobRuntime` in `packages/backend/src/runtime.ts` are the single
assembly point. The API calls them in compact mode and starts the runner in its own process; the
worker container calls the same functions with `JOB_RUNNER_MODE=worker`. A behaviour difference
between the two profiles therefore cannot arise from separate wiring — the limits, the
processor, the handlers and the maintenance schedule are one code path. `disabled` composes the
same runtime but never claims.

Recurring maintenance (`media.cleanup-v1`, every fifteen minutes) runs the MED-01 reclaim passes:
expired upload sessions and detached assets. Reclaiming a source asset now also removes its
derived objects, whose keys are read before the row is deleted.

## Verification

- Unit: variant plan and metadata policy, wrapper construction and argument safety, failure
  classification, backoff and state transitions, and the runner's isolation of a crashing,
  permanently failing or non-`Error`-throwing handler.
- Integration against real PostgreSQL: claim/skip-locked, lease expiry, heartbeat, backoff
  timing, dead state, Admin recovery, and transactional outbox dispatch.
- Integration against real libvips: all four fixtures decode (HEIC through a libheif loader), a
  real address-space cap reaches the child, a timed-out child is killed, a crashed child is
  reported as a value, byte and pixel limits are refused before a decode, EXIF orientation is
  applied and the GPS tag is gone from the output.
- End to end: an upload's outbox message becomes a job, the job writes variants and publishes
  the asset, reprocessing is idempotent, a variant is never a processing input, an undecodable
  image goes to `failed` plus a dead job, a crashed child leaves the asset pending for the
  retry, and reclaiming a source removes its variants.
