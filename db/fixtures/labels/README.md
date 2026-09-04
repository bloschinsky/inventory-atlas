# Label proofs

Stage 0 (HND-03) proof artifacts for the two approved MVP label templates. These
prove printable geometry at actual physical size; the real QR/Code 128 symbols
and the production PDF renderer arrive with LAB-02, which renders from a
versioned template snapshot server-side.

| File | Template | Purpose |
| --- | --- | --- |
| `label-proof.html` | A4 grid (page 1) and standalone 50x30 mm (page 2) | Printable proof measured with a ruler |
| `label-50x30.svg` | Standalone custom 50x30 mm | Single-label proof at exact size |

## Template geometry

- A4 grid: page 210 x 297 mm, page margin 10 mm, label 50 x 30 mm, column gap
  5 mm, row gap 5 mm -> 3 columns x 8 rows = 24 labels.
- Custom label: 50 x 30 mm with a 22 x 22 mm QR area and a 22 x 8 mm Code 128
  area.

## How to verify

1. Open `label-proof.html` in a current Chrome/Firefox and print (or print to
   PDF) with Scale 100%, Margins None, and "Fit to page" OFF.
2. Measure any label with a ruler: it must be exactly 50 x 30 mm.
3. Confirm 3 columns and 8 rows fit within the A4 page margins without clipping.

Both templates feed the LAB-02 physical scan matrix recorded in
[`docs/project/physical-label-matrix.md`](../../../docs/project/physical-label-matrix.md).
