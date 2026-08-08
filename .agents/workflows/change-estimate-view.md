---
description: Safely modify quotation/estimate/return create or edit behavior.
---

1. Read root `AGENTS.md` and `.agents/resources/CODEBASE-MAP.md`.
2. Use `estimate-save-flow`.
3. Map document, item, stock, history and client_purchases effects.
4. Identify create versus edit behavior.
5. Identify QUOTATION / ESTIMATE / RETURN impact.
6. Plan the smallest implementation.
7. Implement without unrelated CreateEstimate refactoring.
8. Use `estimate-stock-ledger` if stock/ledger is touched.
9. Use `estimate-verify`.
10. Review final diff and report the scenario matrix checked.