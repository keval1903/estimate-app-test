---
name: estimate-stock-ledger
description: Protects stock, stock_history, client_purchases, client ledger and quotation/estimate/return consistency. Use for stock deduction/addition, sales returns, quotation conversion/revert, deletions, client balances, purchase history, or stock reports.
---

# Stock / Ledger Consistency

## Entity map

Always inspect the relevant combination of:
- products
- stock_history
- estimates
- estimate_items
- client_purchases
- clients
- payments

## Stock sign rules

- ESTIMATE: stock delta negative
- RETURN: stock delta positive
- QUOTATION: no stock delta
- convert quotation -> estimate: negative
- revert estimate -> quotation: positive

For SQFT/INCH/FEET stock quantity is based on `nos`.
For normal products it is based on `quantity`.

## Client purchase sign rules

- ESTIMATE quantity/amount positive
- RETURN quantity/amount negative
- QUOTATION absent

## Edit rule

Compare original versus new usage by product. Apply only the difference. Do not re-apply the entire document quantity.

## Review partial-failure risk

If multiple writes happen:
- determine what happens if step N fails;
- avoid silently continuing after an important failed write;
- if the task is integrity-focused, consider moving the operation into a database transaction/RPC.

## Verify

Check product stock, corresponding stock_history row(s), document type, client_purchases and visible ledger/report outcome.
