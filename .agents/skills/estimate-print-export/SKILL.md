---
name: estimate-print-export
description: Diagnoses and changes EstimateView browser print, A4/A5 PDF, continuous PNG, WhatsApp and native-share output. Use for cropping, pagination, wrong paper size, missing totals/borders, image quality, WhatsApp routing, or export regressions.
---

# Print / PDF / Image / WhatsApp

## Classify first

Which output fails?
- preview
- print
- PDF
- PNG
- WhatsApp/native share

Do not assume a working PDF means print is correct.

## Existing implementation

Read `src/pages/EstimateView.jsx`, especially:
- `generateCanvas`
- `handlePrint`
- `handleSavePDF`
- `handleSaveImage`
- `handleWhatsApp`
- page grouping/layout
- inline `@media print`

## Invariants

- A4/A5 choice remains exact.
- PDF margins remain 6mm A4 / 4mm A5 unless explicitly changed.
- PNG/WhatsApp remains one continuous image.
- PNG has 16px white padding.
- print excludes controls.
- totals and final rows remain visible.
- header labels such as Prep. By and Date do not wrap/crop.
- 10-digit India phone gets `91`.
- native file sharing remains capability-checked.

## Cropping investigation

Inspect:
- parent overflow;
- fixed/min/max heights;
- scale/transform;
- print width;
- table layout;
- page fragmentation;
- conditional row counts;
- whether total/footer is inside clipped flow.

Use visual evidence when available.

## Verify

- short document;
- long document;
- A4;
- A5 when shared sizing code changed;
- original failing output;
- at least one related export path.
