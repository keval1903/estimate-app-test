---
name: estimate-save-flow
description: Safely changes quotation, estimate, sales-return create/edit behavior and bill persistence. Use for CreateEstimate.jsx save logic, bill numbering, item persistence, draft behavior, document type changes, or reliability problems around saving.
---

# Estimate Save Flow

Read:
- `src/pages/CreateEstimate.jsx`
- relevant SQL migrations
- `.agents/resources/CODEBASE-MAP.md`

## Preserve

- edit keeps bill number;
- create gets bill number from `get_next_bill_number()`;
- saved item snapshots preserve historical values;
- QUOTATION has no stock effect;
- ESTIMATE deducts stock;
- RETURN adds stock;
- edit applies stock delta versus original saved items;
- client_purchases mirrors ESTIMATE/RETURN signs.

## Before editing

Write a small impact map:

`estimate -> items -> stock -> stock_history -> client_purchases -> site/draft`

Mark which steps the task actually needs.

## Reliability

The current flow uses several sequential Supabase calls. For a cosmetic/field-only task, do not redesign persistence.

For a task about partial saves, concurrency, duplicate effects or integrity, prefer a database RPC/transaction design rather than adding more sequential client calls.

Never consume a new bill number just to preview/open a form.

## Verification matrix

At minimum, choose relevant cases:
- new quotation;
- new estimate;
- new return;
- edit same quantities;
- edit increased/decreased stock quantity;
- historical bill number unchanged;
- stock-tracked and non-stock product.
