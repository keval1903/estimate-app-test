---
name: estimate-debug
description: Diagnoses CCAI Estimate App bugs before editing code. Use for regressions, incorrect billing behavior, UI bugs, save failures, stock/ledger mismatches, search problems, print/export defects, or when a previous attempted fix did not solve the issue.
---

# Estimate Debug

Read root `AGENTS.md` and `.agents/resources/CODEBASE-MAP.md`.

## Procedure

1. Turn the report into an observable expected-vs-actual statement.
2. Identify the exact route/page/output path.
3. Reproduce when practical.
4. Trace the user action -> state -> helper -> Supabase/output path.
5. Find the earliest divergence from expected behavior.
6. Search callers and sibling flows before editing.
7. Form a hypothesis and gather evidence.
8. Only then make the smallest fix.
9. Re-run the original scenario.
10. Run one nearby regression case.
11. Run `npm run lint` and `npm run build` when dependencies are available.
12. Review `git diff`.

## Decision tree

If the symptom is:
- wrong amount/quantity/GST -> inspect `calcItem` / `calcTotals` and snapshots;
- wrong stock -> inspect current document type, create/edit delta and conversion/revert;
- wrong ledger -> inspect estimates/returns/payments/client_purchases together;
- print/PDF/PNG mismatch -> classify output path first;
- product not found -> inspect normalization + loaded product range + search matcher;
- auth/logout -> inspect AuthContext + sessionExpiry + user_roles before UI.

Do not patch only the visible symptom if shared state is already wrong upstream.
