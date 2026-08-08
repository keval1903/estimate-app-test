# Verification Gate

Recommended activation: Always On

This project uses npm and currently defines:

```bash
npm run lint
npm run build
```

There is no standard automated test script today.

Rules:
- Never invent `npm test` / `npm run typecheck`.
- Do not install/change dependencies merely to make verification convenient.
- If dependencies are unavailable, say so and use safe inspection/browser checks instead.
- For a non-trivial pure helper, a tiny focused runnable check is acceptable when it does not require adding a test framework.
- UI, print, share, voice and persistence changes require scenario verification, not only lint/build.
- Review `git diff` before completion.
- Report pre-existing failures separately from failures introduced by the change.
