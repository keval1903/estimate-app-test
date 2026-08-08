# Estimate Domain Integrity

Recommended activation: Always On

Protect these current application invariants:

- Existing documents keep their bill number on edit.
- New bill numbers come from `get_next_bill_number()`.
- `QUOTATION` does not alter stock.
- `ESTIMATE` deducts tracked stock.
- `RETURN` adds tracked stock.
- Editing ESTIMATE/RETURN applies stock delta versus the original items.
- Quotation -> Estimate conversion deducts stock and writes partywise purchase history.
- Estimate -> Quotation revert restores stock and removes partywise purchase history.
- `client_purchases` is positive for ESTIMATE and negative for RETURN.
- Historical item rates/calculation snapshots belong to the saved document; do not silently replace them with current Product Master values.
- Type-sensitive delete/soft-delete behavior must be preserved unless the task explicitly changes it.

When a change crosses document type, stock, ledger or delete behavior, inspect every coupled write before editing.
