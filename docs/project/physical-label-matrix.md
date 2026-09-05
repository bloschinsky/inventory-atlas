# Physical label test matrix

Stage 0 (HND-03) record of the printer and mobile devices used by the physical
label scan matrix. The matrix is executed and re-recorded by LAB-02/LAB-03 and
again for every release candidate; this document freezes the device roster and
the scenarios so results are comparable across releases.

## Scenarios (blueprint 13.2 / 20.2)

- Templates: A4 grid and custom 50x30 mm.
- Symbologies: QR (default) and Code 128 (optional).
- Selection: exactly one symbology per label; QR and Code 128 are never rendered
  together on the same label.
- Output: laser and inkjet, printed at actual size (no browser scaling).
- Scanning: iPhone (Safari) and Android (Chrome).
- Robustness samples: normal, low light, mild blur, and worn-label.

The proof artifacts to print are in `db/fixtures/labels/` (`label-proof.html`,
`label-50x30.svg`).

## Device roster

Recorded per release candidate. Rows below are the roster template; concrete
models, OS versions, and browser versions are confirmed on the physical devices
used for a given release and captured in that release's record. A roster is
complete when every row has a confirmed value.

| Role | Device | Details to confirm |
| --- | --- | --- |
| Test printer | OKI B412 | Laser, OKI B412 PCL6 driver, 600 dpi, A4; 50 x 30 mm geometry confirmed |
| Cross-printer compatibility | Generic A4 PDF | Laser/inkjet output remains part of the LAB-02 matrix; no printer-specific layout profile |
| iPhone | iPhone 16 Pro | iOS and Safari versions recorded when the LAB-03 matrix runs |
| Android phone | Samsung Galaxy Note 9 | Android and Chrome versions recorded when the LAB-03 matrix runs |
| Ruler/caliper | Manual project-owner measurement | Used to confirm the printed 50 x 30 mm label, 5 mm gaps, and 10 mm margins |

The project owner designated the OKI B412, iPhone 16 Pro, and Samsung Galaxy
Note 9 as the physical test devices on 2026-09-04. The label output is a generic
A4 PDF rather than a printer-specific profile. The OKI B412 is available through
the OKI B412 PCL6 USB and WSD queues. Its Stage 0 geometry was confirmed by a
physical print and measurement; the full cross-printer and mobile matrix is
executed by LAB-02/LAB-03.

## Stage 0 geometry trials

| Date | Printer/queue | Source and settings | Result | Status |
| --- | --- | --- | --- | --- |
| 2026-09-05 | OKI B412 / WSD | A4 PDF sent while the queue defaulted to Letter | 12 labels printed without clipping; 50 x 30 mm became 47 x 28 mm, 5 mm gaps remained 5 mm, top margin remained 10 mm, and left margin became 14 mm | Failed: A4-to-Letter fit applied approximately 94% scaling |
| 2026-09-05 | OKI B412 / WSD | A4 PDF, A4 queue, 600 dpi, scaling disabled | 12-label 3 x 4 half-sheet grid printed without clipping; 50 x 30 mm labels, 5 mm gaps, and 10 mm top/left margins confirmed | Passed |

The failed trial identified a required preflight check: both the PDF page and
the physical printer queue must use A4 with scaling disabled. The passing proof
contains six QR-only labels and six Code-128-only labels. QR remains the default;
the optional Code 128 area is 30 x 11 mm, approximately 36-38% larger than the
initial proof.

## Recorded result template

For each release candidate, record pass/fail per cell:

| Template | Symbology | Printer | iPhone scan | Android scan | Low light | Mild blur | Worn label |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A4 grid | QR | | | | | | |
| A4 grid | Code 128 | | | | | | |
| 50x30 mm | QR | | | | | | |
| 50x30 mm | Code 128 | | | | | | |

The physical label matrix and the mobile scan targets remain explicit release
gates. Supported iOS Safari and Android Chrome targets follow
[`browser-support.md`](browser-support.md).
