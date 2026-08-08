# Change Stock Ledger

Description: Modify stock, returns, quotation conversion, client purchases or ledger behavior consistently.

1. Read root `AGENTS.md`.
2. Use `estimate-stock-ledger`.
3. Map sign/unit rules for the requested document type.
4. Trace current writes across products, stock_history, estimates/items and client_purchases.
5. Identify partial-failure/concurrency risk.
6. If the task is integrity-focused, consider a DB RPC/transaction plan before adding frontend writes.
7. Implement the minimum coherent change.
8. Verify stock, history, document state, purchase history and visible ledger/report.
9. Run lint/build when available.
10. Review diff.
