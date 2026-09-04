# Physical label test matrix

Stage 0 (HND-03) record of the printer and mobile devices used by the physical
label scan matrix. The matrix is executed and re-recorded by LAB-02/LAB-03 and
again for every release candidate; this document freezes the device roster and
the scenarios so results are comparable across releases.

## Scenarios (blueprint 13.2 / 20.2)

- Templates: A4 grid and custom 50x30 mm.
- Symbologies: QR (default) and Code 128 (optional).
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
| Laser printer | To confirm | Model, DPI, driver, paper size |
| Inkjet printer | To confirm | Model, DPI, driver, paper size |
| iPhone | To confirm | Model, iOS version, Safari version |
| Android phone | To confirm | Model, Android version, Chrome version |
| Ruler/caliper | To confirm | Used to verify 50 x 30 mm actual size |

Stage 0 host discovery found an OKI B412 laser printer using the OKI B412 PCL6
driver (USB and WSD queues). It is a candidate for the laser row, but the row
remains unconfirmed until a proof is physically printed and measured. No
physical inkjet, iPhone, or Android device was connected during discovery, so
their models cannot be recorded honestly from repository automation.

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
