# Media capability fixtures

Known, small, deterministic images used by the MED-02 startup decode/capability
checks (blueprint section 12 and section 20.2). Each fixture is a 16x16 solid
color image; the point is format coverage and reproducibility, not visual
content.

| Format | File | Committed | How it is produced |
| --- | --- | --- | --- |
| PNG | `capability-16x16.png` | Yes | ffmpeg (base toolchain) |
| JPEG | `capability-16x16.jpg` | Yes | ffmpeg (base toolchain) |
| WebP | `capability-16x16.webp` | Yes | ffmpeg (base toolchain) |
| HEIC | `capability-16x16.heic` | Yes | Pillow 10.4.0 + `pillow-heif` 0.18.0, quality 90 |

Sizes and SHA-256 checksums are pinned in [`manifest.json`](manifest.json). CI in
later stages verifies each committed fixture against its recorded checksum.

## Regenerating

```powershell
pwsh db/fixtures/media/generate-media-fixtures.ps1
```

The base invocation regenerates PNG/JPEG/WebP. To regenerate HEIC, install the
exact optional fixture tools in an isolated environment and pass
`-GenerateHeic`:

```powershell
python -m pip install pillow==10.4.0 pillow-heif==0.18.0
pwsh db/fixtures/media/generate-media-fixtures.ps1 -GenerateHeic
```

After regenerating, update `bytes` and `sha256` in `manifest.json`.

## HEIC scope

The checked-in HEIC is only a known decoder/capability input. It does not select
the production media library or approve codec distribution. ADR-011 still
requires MED-02 to perform startup capability checks and the separate
HEIC/libheif license review recorded in the dependency baseline.
