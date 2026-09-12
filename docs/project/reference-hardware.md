# Reference hardware and performance dataset profile

Stage 0 (HND-03) record of the reference hardware, storage profile, and
performance acceptance dataset used by the release performance gates. Targets
from blueprint section 20.4 become release gates only after the reference
hardware and test procedure are recorded here and confirmed on the actual
machine used for a release candidate.

## Warm homelab reference targets (blueprint 20.4)

| Metric | Target |
| --- | --- |
| p95 Item read | under 300 ms |
| p95 default search | under 800 ms |
| External search engine | none (PostgreSQL only) |
| Storage move | recorded for subtree sizes 10, 100, 1,000, and 10,000 nodes/items |

These are warm-cache targets on the recorded reference machine. A measurement is
valid only when the dataset below and the recorded procedure are used.

## Performance acceptance dataset (blueprint 20.4)

The dataset is generated (not committed as a large binary) by the generator that
SRCH-02 owns; the small review seeds live in `db/fixtures/`.

- 100,000 Items.
- 1,000 storage nodes with at least one eight-level subtree (see
  `db/fixtures/storage/tree-fixtures.json`).
- 30 field definitions across several data types.
- 10-20 attribute values per average Item.
- Representative tags, media metadata, and mixed English/Ukrainian labels.

## Stage 0 reference machine profile

Recorded on 2026-09-04 from the machine used to prepare the reference fixtures.
This freezes a concrete comparison baseline; it does not claim that the later
100k performance gates have already run. Each release candidate records whether
it used this machine or attaches a replacement profile before comparing results.

| Attribute | Value |
| --- | --- |
| Role | Self-hosted homelab / small dedicated server |
| CPU | Intel Core i7-6600U, 2 cores / 4 threads, 2.60 GHz nominal |
| Memory | 19.9 GiB visible to the OS |
| Storage | Kingston SNVS1000G, 1 TB NVMe SSD, NTFS |
| Storage profile | Local media on the same volume by default; S3/MinIO optional |
| OS/kernel | Windows 10 Pro 64-bit, 10.0.19045 (build 19045) |
| Container runtime | Docker Desktop 4.89.0; Engine 29.7.2; Compose 5.5.0 |
| PostgreSQL | Version pinned in `docs/project/dependencies.md`; default compact profile |
| Deployment profile | Compact (API + lightweight job runner in one container) |
| Network | Local/LAN; no external search engine |

Docker was installed and FND-02 was validated on this machine on 2026-09-06.
The Docker-only development and compact deployment workflows passed startup,
health, real-PostgreSQL integration, Playwright, isolation, and persistence
checks. The containerized Docker tooling used CLI 29.8.0 and Compose 5.5.1.

## Recorded procedure

1. Deploy the compact Docker Compose profile on the reference machine.
2. Load the generated 100k dataset and warm the cache with a representative read
   and default-search pass.
3. Record p95 Item read and p95 default search over a fixed request count.
4. Record storage-move duration for subtree sizes 10, 100, 1,000, and 10,000.
5. Attach the query plans and the concrete machine profile to the release record.

Related fixtures: `db/fixtures/README.md`,
`db/fixtures/storage/tree-fixtures.json`. Physical label devices are recorded in
[`physical-label-matrix.md`](physical-label-matrix.md).
