---
trigger: glob
globs: src/pages/CreateEstimate.jsx
---

# CreateEstimate Safe-Change Rule

Recommended activation: Glob
Suggested glob: `src/pages/CreateEstimate.jsx`

`CreateEstimate.jsx` is a large, high-risk file. Keep changes surgical.

Before editing:

1. Locate the exact helper/event/effect responsible.
2. Search all uses of the state/function being changed.
3. Determine whether create and edit share the same path.
4. Determine whether the change affects QUOTATION, ESTIMATE, RETURN or all three.
5. Determine whether stock or `client_purchases` changes are involved.

Do not split/rewrite the whole component during a bug fix.

Calculation behavior currently lives in local `calcItem` / `calcTotals` helpers. Do not duplicate alternate formulas elsewhere.

Draft restore/autosave uses localStorage. A form-state change may also require draft compatibility.

After changes, verify the exact requested flow plus one nearby create/edit regression.
