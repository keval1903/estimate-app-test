# Fix Print Export

Description: Fix print/PDF/PNG/WhatsApp output without regressing other rendering paths.

1. Read root `AGENTS.md`.
2. Use `estimate-print-export` and `estimate-debug`.
3. Classify the exact failing path.
4. Reproduce with representative data.
5. Inspect the relevant DOM/layout and print/export code.
6. State the root cause before editing.
7. Apply a narrow fix.
8. Verify original path, short/long document and any shared affected output.
9. Run lint/build when dependencies are available.
10. Review `git diff`.
