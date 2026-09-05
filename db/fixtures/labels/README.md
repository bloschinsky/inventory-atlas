# Label proofs

Stage 0 (HND-03) proof artifacts for the two approved MVP label templates. These
prove printable geometry at actual physical size; the real QR/Code 128 symbols
and the production PDF renderer arrive with LAB-02, which renders from a
versioned template snapshot server-side.

| File | Template | Purpose |
| --- | --- | --- |
| `label-proof.html` | Half-sheet A4 grid of 12 labels | Printable 50x30 mm proof measured with a ruler |
| `label-50x30.svg` | Standalone custom 50x30 mm | Single-label proof at exact size |

## Template geometry

- A4 proof grid: page 210 x 297 mm, page margin 10 mm, label 50 x 30 mm,
  column gap 5 mm, row gap 5 mm -> 3 columns x 4 rows = 12 labels. The lower
  half is intentionally left unused for economical test prints.
- Each label renders one selected symbology, never QR and Code 128 together.
  QR is the default with a 22 x 22 mm code area. Optional Code 128 uses a
  30 x 11 mm code area, approximately 36-38% larger than the initial proof.

## How to verify

1. Open `label-proof.html` in a current Chrome/Firefox and print (or print to
   PDF) with A4 paper, Scale 100% / Actual size, Margins None, and "Fit to page"
   OFF. The printer queue paper size must also be A4; a Letter queue shrinks the
   A4 PDF to approximately 94%.
2. Measure any label with a ruler: it must be exactly 50 x 30 mm.
3. Confirm 3 columns and 4 rows fit within the upper half of the A4 page
   margins without clipping.

Both templates feed the LAB-02 physical scan matrix recorded in
[`docs/project/physical-label-matrix.md`](../../../docs/project/physical-label-matrix.md).
