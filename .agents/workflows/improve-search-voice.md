---
description: Improve product search or speech-to-text while preserving existing typed-search behavior.
---

1. Read root `AGENTS.md`.
2. Use `estimate-search-voice`.
3. Reproduce weak search/voice examples.
4. Determine whether the failure is transcript normalization, matching, ranking or product loading.
5. Reuse current search utilities before adding a new engine.
6. Apply the smallest change.
7. Verify word, numeric, multi-term and rapid-typing examples.
8. Verify voice feeds the same search path if voice is touched.
9. Run lint/build when available.
10. Review diff.