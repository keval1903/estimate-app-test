---
trigger: model_decision
---

# Print / PDF / PNG / WhatsApp Rule

Recommended activation: Model Decision

Use for `EstimateView.jsx`, print CSS, PDF, image, A4/A5, page layout, WhatsApp or native sharing.

First classify the failing path:
1. screen preview
2. browser print
3. PDF
4. saved PNG
5. WhatsApp/native share

They are not equivalent.

Preserve:
- A4/A5 user choice;
- PDF margins: A5 4 mm, A4 6 mm;
- one continuous PNG for image/WhatsApp export;
- 16 px white PNG padding;
- `navigator.canShare({ files })` capability check;
- Indian 10-digit number -> `91` prefix;
- no app controls in print;
- visible borders/totals/header labels.

For cropping/layout defects inspect overflow, fixed heights, transforms/scaling, page containers, table fragmentation and print media CSS before changing business markup.

After shared layout changes verify short + long document and every affected output path.
