---
name: estimate-db-migration
description: Plans and reviews Supabase/PostgreSQL schema, RPC, constraint, RLS, sequence and migration changes for this repository. Use whenever SQL or database guarantees must change.
---

# Database Migration

Do not execute production migrations automatically.

## Read the schema history

Relevant files may include:
- `00_full_database_schema.sql` (Contains all final state definitions and migrations)

## Plan

State:
- current behavior;
- required behavior;
- exact objects changed;
- data backfill need;
- constraint/index/RLS/RPC effects;
- compatibility with current frontend;
- rollback/recovery approach.

## Special cautions

- `bill_number` uniqueness and sequence/RPC behavior;
- product calculation-type constraints;
- estimate-item snapshot compatibility;
- foreign-key delete effects;
- auth/user_roles;
- current project RLS posture.

Prefer database guarantees for uniqueness/concurrency-critical behavior.
