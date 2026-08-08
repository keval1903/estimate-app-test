---
name: estimate-verify
description: Verifies Estimate App code changes with the repository's real npm commands, diff review and flow-specific browser checks. Use after implementing or fixing code.
---

# Verification

## Automated

If dependencies are installed:

```bash
npm run lint
npm run build
```

Or run:

```bash
bash .agents/skills/estimate-verify/scripts/check.sh
```

Do not invent test/typecheck commands.

## Flow checks

Pick only the relevant matrix, but do not skip the user's exact scenario.

Calculation:
- SQFT or dimension-based item
- QUANTITY item
- GST if touched
- edit if touched

Stock:
- tracked product
- no-stock product
- create/edit delta
- conversion/revert/return when touched

Output:
- original failing path
- short and long document
- A4/A5 when sizing code changed

Auth:
- login
- reload/persisted session
- logout
- affected role restriction

Search:
- word fragment
- numeric fragment
- rapid typing
- voice if touched

## Diff

Inspect `git diff` for:
- unrelated changes;
- debug logs;
- secrets;
- accidental package changes;
- duplicated calculation/stock logic;
- modified generated output.

Report exactly what passed and what could not be run.
