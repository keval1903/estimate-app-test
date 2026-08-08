---
trigger: model_decision
---

# Data / Stock / Ledger Rule

Recommended activation: Model Decision

Use for Supabase writes, estimate persistence, stock, returns, quotations, clients, payments, ledger, stock history, client purchases, conversions and deletions.

Before editing, map the writes and compensation/rollback risk.

Relevant entities:
- `products`
- `stock_history`
- `estimates`
- `estimate_items`
- `clients`
- `payments`
- `client_purchases`

Stock quantity semantics:
- SQFT / INCH / FEET -> `nos`
- QUANTITY -> `quantity`

Avoid read-modify-write changes to stock without considering concurrent users.

Current flows contain multiple sequential client-side writes. Do not add more partial-failure windows casually. If correctness under concurrency is the task, prefer designing one database-side RPC/transaction rather than stacking more frontend calls.

Do not execute migrations automatically.
