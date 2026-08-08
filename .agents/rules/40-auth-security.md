---
trigger: model_decision
---

# Auth / RBAC / Session Rule

Recommended activation: Model Decision

Use when touching login, logout, roles, user management, active sessions, expiry, Supabase Auth, authorization or RLS.

Inspect:
- `src/context/AuthContext.jsx`
- `src/pages/Login.jsx`
- `src/pages/UserManagement.jsx`
- `src/lib/sessionExpiry.js`
- `rbac_migration.sql`
- `single_session_migration.sql`
- `delete_user_migration.sql`

Current behavior includes ADMIN/STAFF roles, `is_active`, `current_session_token`, and a 5:00 AM client-side expiry mechanism.

Never:
- expose a service-role key to Vite/client code;
- remove admin authorization checks from RPCs to solve a UI problem;
- treat hiding an ADMIN button as the only authorization control;
- silently change the project's current RLS model during unrelated work.

Security architecture changes require an explicit plan and migration review.
