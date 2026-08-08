---
name: estimate-auth-rbac
description: Safely changes Supabase login/logout, ADMIN/STAFF roles, user activation, one-active-session enforcement, 5 AM session expiry, user management or admin RPC authorization.
---

# Auth / RBAC / Session

Inspect first:
- `src/lib/supabase.js`
- `src/context/AuthContext.jsx`
- `src/pages/Login.jsx`
- `src/pages/UserManagement.jsx`
- `src/lib/sessionExpiry.js`
- RBAC/session/admin SQL migrations

## Current model

- Supabase Auth
- ADMIN / STAFF
- is_active
- current_session_token
- IndexedDB-backed auth storage
- client-side next-5-AM expiry
- admin RPC checks for privileged operations

## Safety

- never use service-role in browser;
- never remove RPC authorization checks to fix frontend behavior;
- do not rely only on hidden buttons;
- do not silently enable/disable RLS as collateral work;
- preserve existing users during schema migration.

## Session changes

Clarify whether the requirement is:
- fixed local wall-clock logout;
- max session duration;
- one-active-device;
- auth token expiry.

Those are different mechanisms. Change only the one requested.

Verify login, reload, logout and role-restricted behavior affected by the change.
