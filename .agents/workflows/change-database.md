---
description: Plan and implement a Supabase/PostgreSQL migration without guessing the final schema.
---

1. Read root `AGENTS.md`.
2. Use `estimate-db-migration`.
3. Inspect every migration relevant to the target object.
4. Describe current and desired state.
5. Plan migration, compatibility, backfill and rollback.
6. Do not execute against production automatically.
7. Update frontend only where necessary.
8. Run lint/build for frontend changes.
9. Review SQL and git diff.
10. Report manual deployment steps separately.