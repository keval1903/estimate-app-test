# CCAI Estimate App — Codebase Map

Generated from the uploaded repository snapshot on 2026-08-08.

## Entry and routing

- `src/main.jsx` — React entry
- `src/App.jsx` — protected routes
- `src/context/AuthContext.jsx` — Supabase auth, roles, active session, presence

Routes:
- `/login` -> `Login.jsx`
- `/` -> `Home.jsx`
- `/products` -> `Products.jsx`
- `/estimates` -> `EstimateList.jsx`
- `/estimate/new` -> `CreateEstimate.jsx`
- `/estimate/edit/:id` -> `CreateEstimate.jsx`
- `/estimate/view/:id` -> `EstimateView.jsx`
- `/stock-report` -> `StockReport.jsx`
- `/clients` -> `Clients.jsx`
- `/clients/:id` -> `ClientLedger.jsx`
- `/sales-report` -> `SalesReport.jsx`
- `/users` -> `UserManagement.jsx`

## Largest/highest-risk UI files

Approximate snapshot sizes:
- `CreateEstimate.jsx` ~1565 lines
- `Products.jsx` ~956
- `EstimateView.jsx` ~890
- `ClientLedger.jsx` ~878
- `StockReport.jsx` ~679
- `EstimateList.jsx` ~410

Prefer surgical edits.

## Estimate create/edit

File: `src/pages/CreateEstimate.jsx`

Contains:
- `todayIST()`
- `calcItem()`
- `calcTotals()`
- document type state
- draft restore/autosave
- product/client/site autocomplete
- item add/edit
- inline Product creation
- estimate update/create
- estimate_items rewrite
- stock mutation/history
- client_purchases synchronization

Create:
1. validate
2. resolve client
3. RPC `get_next_bill_number`
4. insert estimate
5. insert estimate items
6. mutate stock/history for ESTIMATE or RETURN
7. synchronize client_purchases
8. save site
9. clear draft
10. navigate to view

Edit:
1. update estimate
2. delete existing estimate_items
3. insert current estimate_items
4. compute stock delta versus original items
5. mutate stock/history
6. replace client_purchases
7. save site
8. clear draft
9. navigate

Consistency warning: this is a multi-write client-side flow, not one visible DB transaction.

## Calculations

`SQFT`:
- quantity = length * width * nos
- amount = ceil(quantity * rate)

`INCH` / `FEET`:
- amount = ceil(length * width * nos * rate)
- quantity for UI/save behavior is nos

`QUANTITY`:
- amount = ceil(quantity * rate)

Totals:
- subtotal = sum calculated amount
- GST percent = rounded whole number
- GST amount = round(subtotal * rate/100)
- grand total = subtotal + GST

## Product search

Reusable:
- `src/lib/searchUtils.js`
- `src/lib/synonyms.js`
- `src/hooks/useVoiceSearch.jsx`

`CreateEstimate.jsx` and `Products.jsx` each implement filtering around those helpers.

Current Product Master loading in those screens:
- range 0..999
- range 1000..1999

`fuse.js` exists in package.json but is not currently imported.

## Stock

Product fields include:
- `has_stock`
- `stock`
- `min_stock`

History lives in `stock_history`.

Important mutation types found:
- `MANUAL_ADJUST`
- `ESTIMATE_DEDUCT`
- `ESTIMATE_UPDATE`
- `RETURN_ADD`
- `RETURN_UPDATE`
- `QUOTATION_CONVERT`
- `REVERT_TO_QUOTATION`

Piece/dimension calculation types use `nos` for stock movement.

## Quotation conversion/revert

File: `src/pages/EstimateView.jsx`

Quotation -> Estimate:
- checks stock
- deducts stock
- writes stock history
- resolves client if possible
- updates type to ESTIMATE
- recreates client_purchases

Estimate -> Quotation:
- adds stock back
- writes stock history
- removes client_purchases
- updates type to QUOTATION

These are also multi-write client-side operations.

## Client ledger

Files:
- `src/pages/Clients.jsx`
- `src/pages/ClientLedger.jsx`
- `ledger_migration.sql`
- `client_purchases_migration.sql`

Balance concepts combine:
- opening balance
- estimates
- returns
- payments

Deleted estimate/return types are still included in some ledger/backup calculations. Inspect exact intended semantics before changing deletion/reporting.

## Output

File: `src/pages/EstimateView.jsx`

Screen/print:
- `window.print()`
- inline `@page` / `@media print`

PDF:
- dynamic import `jspdf`
- renders each `.estimate-page`
- A5/A4
- margin 4mm/6mm

PNG:
- dynamic import `html2canvas`
- one continuous image mode
- 16px white padding

WhatsApp:
- native Web Share with file when supported
- desktop fallback opens `wa.me` and downloads PNG
- 10-digit phone gets `91` prefix

## Auth/session

Files:
- `src/lib/supabase.js`
- `src/context/AuthContext.jsx`
- `src/pages/Login.jsx`
- `src/pages/UserManagement.jsx`
- `src/lib/sessionExpiry.js`

Supabase auth storage is custom IndexedDB storage with `idb-keyval`.

Role table:
- ADMIN / STAFF
- is_active
- current_session_token

Session expiry helper targets the next 5:00 AM according to the browser/device local clock.

## SQL history

Do not read only one SQL file.

- `supabase_setup.sql` — core products/sites/estimates/items/sequence/RPC
- `rbac_migration.sql` — user_roles + admin reset password
- `single_session_migration.sql` — current_session_token
- `gst_migration.sql` — subtotal/GST fields
- `ledger_migration.sql` — clients/payments/client_id
- `client_purchases_migration.sql` — partywise purchase history
- `product_group_migration.sql` — product grouping
- `delete_user_migration.sql` — admin user deletion RPC

Current SQL history includes RLS being disabled on multiple app tables. Treat security changes as a dedicated task.

## Backup/deployment

- `src/lib/offlineStorage.js` — local cache snapshot
- `src/lib/excelBackup.js` — Excel backup
- `api/daily-backup.js` — scheduled email backup endpoint
- `vercel.json` — cron + rewrites
- `netlify.toml` — SPA build/redirect
- `.gitignore` excludes `.env`

## Verification

Available:
- `npm run lint`
- `npm run build`

Not defined:
- automated `test`
- `typecheck`

For browser-visible work, manually exercise the exact flow.
