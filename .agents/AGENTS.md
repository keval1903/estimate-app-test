# CCAI Estimate App — Agent Engineering Contract

This file is the canonical project instruction file for coding agents.

## 1. Repository and stack

This is a JavaScript/JSX React application built with:

- React 19
- Vite 8
- React Router
- Supabase JS
- Oxlint
- npm (`package-lock.json` is authoritative)
- browser-native Web Speech API for voice input
- `html2canvas` + `jsPDF` for estimate exports
- `xlsx` for Excel backup/export
- IndexedDB via `idb-keyval` for Supabase auth storage/session expiry support

Do not convert the project to TypeScript, Next.js, another router, another database client, or another build tool unless explicitly requested.

Actual package scripts:

```bash
npm run dev
npm run lint
npm run build
npm run preview
```

There is currently no automated `test` or `typecheck` script. Never claim tests/typecheck passed when those commands do not exist.

## 2. Git safety

- Never push to GitHub automatically.
- Never create or merge a PR unless explicitly requested.
- Before editing, inspect `git status`.
- Do not discard unrelated local changes.
- Before completion, inspect `git diff`.
- Avoid generated/unrelated files in the diff.

## 3. Working method

For every non-trivial change:

1. Read the requested behavior carefully.
2. Inspect the actual files involved and trace the flow end-to-end.
3. Identify the root cause or extension point before editing.
4. Search for existing helpers/patterns first.
5. Make the smallest complete change.
6. Do not refactor unrelated code during a bug fix.
7. Run applicable existing verification.
8. Verify the exact user scenario in the browser when UI behavior is involved.
9. Review the final diff.
10. Report what was actually verified.

Prefer boring, local, existing patterns over clever abstractions.

The existing Ponytail skills under `.agents/skills/ponytail*` are intentional. Keep the same "minimum code that safely works" philosophy, but never let minimalism override data integrity, security, accessibility, or billing correctness.

## 4. High-risk files

Treat these files as change-sensitive:

- `src/pages/CreateEstimate.jsx`
  - estimate/quotation/return create and edit
  - calculations
  - draft restore
  - product/client/site autocomplete
  - stock mutation
  - client purchase synchronization
- `src/pages/EstimateView.jsx`
  - print
  - PDF
  - single-image export
  - WhatsApp/native share
  - quotation conversion/revert
  - client balance rendering
- `src/pages/Products.jsx`
  - Product Master
  - stock adjustments
  - import/export
  - product search
- `src/pages/ClientLedger.jsx`
  - payment, purchase and bill balance logic
  - ledger PDF/share
- `src/context/AuthContext.jsx`
  - role loading
  - active-session enforcement
  - presence
- SQL files in repository root
  - schema, auth/RBAC, GST, ledger, stock-related evolution

A request touching one of these areas should not trigger an unrelated rewrite of the whole file.

## 5. Document types and lifecycle

Current document types include:

- `QUOTATION`
- `ESTIMATE`
- `RETURN`
- `DELETED_ESTIMATE`
- `DELETED_RETURN`

Preserve current semantics unless explicitly changing the business rule:

- A quotation does not deduct stock.
- Converting a quotation to an estimate deducts stock and creates partywise purchase records.
- Reverting an estimate to a quotation adds the stock back and removes partywise purchase records.
- An estimate deducts tracked stock.
- A sales return adds tracked stock.
- Editing an estimate/return applies the delta versus the original saved items, not the whole quantity again.
- Deletion behavior is type-sensitive; do not casually convert soft-delete behavior into hard delete.
- Editing an existing document preserves its bill number.
- A newly created document receives a bill number from the database RPC `get_next_bill_number()`.

Do not change these flows without tracing all related stock, ledger and history effects.

## 6. Billing calculations

Current calculation behavior is defined in `src/pages/CreateEstimate.jsx`.

Important current semantics:

- `SQFT`: `length * width * nos`; amount is rounded upward with `Math.ceil(quantity * rate)`.
- `INCH` / `FEET`: amount uses `length * width * nos * rate` with fallback dimension behavior; quantity is treated as `nos`.
- `QUANTITY`: amount uses `quantity * rate`.
- GST percent is rounded to a whole number before GST is calculated.
- GST amount is rounded with `Math.round`.
- Monetary display uses Indian formatting (`en-IN`) with two decimals in estimate output.
- Discount handling can modify the effective item rate; do not accidentally replace historical saved rates with current Product Master rates.

Do not "normalize" or change rounding rules as cleanup. If the requested task changes calculations, explicitly state which existing rule changes.

## 7. Product Master, search and voice

Current search is implemented with:

- `src/lib/searchUtils.js` → subsequence fuzzy matching
- `src/lib/synonyms.js` → query normalization
- local term/smart-term matching in screens
- `src/hooks/useVoiceSearch.jsx` → browser SpeechRecognition / webkitSpeechRecognition

`fuse.js` is installed but is not currently the active search engine. Do not introduce or rewrite search around Fuse merely because it is installed.

Voice input currently:
- uses language `en-IN` by default;
- supports interim results;
- normalizes some domain-specific speech terms.

Preserve typed search when improving voice search. Voice should feed the same product-search path rather than becoming a separate product lookup system.

## 8. Stock and ledger consistency

Stock is business-critical.

When changing create/edit/convert/revert/delete behavior, trace all of:

- `products.stock`
- `stock_history`
- `estimates`
- `estimate_items`
- `client_purchases`
- `clients`
- `payments`

Stock units currently differ by calculation type:
- `SQFT`, `INCH`, `FEET` use `nos` as stock quantity;
- normal quantity products use `quantity`.

`ESTIMATE` decreases stock.
`RETURN` increases stock.

`client_purchases` uses positive quantity/amount for estimates and negative quantity/amount for returns.

Do not update one side of these flows and forget the others.

Important architecture note: several current save/conversion flows perform multiple Supabase writes from the client rather than one database transaction. Treat these sections as consistency-sensitive. Do not make them more fragmented. If a task explicitly targets reliability/concurrency, consider a database RPC/transaction plan rather than adding more client-side steps.

## 9. Supabase and SQL

Client configuration is in `src/lib/supabase.js` and uses:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Never expose a Supabase service-role key in browser code.

The complete SQL history has been combined into:
- `00_full_database_schema.sql`

This file contains the final production schema including all previous migrations (RBAC, Ledger, Client Purchases, RLS, etc).

The existing SQL currently disables RLS on multiple application tables as part of the present architecture. Do not silently rewrite the security model during an unrelated feature. If a task is security-related, explicitly analyze current RLS/RPC behavior and propose the migration deliberately.

Never execute destructive SQL or production migrations automatically without explicit permission.

## 10. Authentication, roles and sessions

Current application behavior includes:

- Supabase Auth
- `ADMIN` / `STAFF` roles in `user_roles`
- `is_active`
- `current_session_token` for one-active-session behavior
- auth storage backed by IndexedDB
- client-side session expiry targeting the next 5:00 AM
- admin-only UI for destructive/administrative operations

When touching auth:

- inspect `src/context/AuthContext.jsx`, `src/pages/Login.jsx`, `src/pages/UserManagement.jsx`, `src/lib/sessionExpiry.js` and relevant SQL;
- preserve active/inactive user behavior;
- preserve single-session semantics unless explicitly changing them;
- never weaken an admin RPC authorization check just to make the UI work;
- do not confuse hidden UI with authorization.

## 11. Print, PDF, PNG and WhatsApp

These are distinct rendering/sharing paths. Diagnose the failing path before editing.

Current invariants from the application:

### Browser Print
- uses `window.print()`;
- paper size is user-selected A4/A5;
- inline print CSS lives in `EstimateView.jsx`;
- no app navigation/actions should appear in output;
- totals, borders and header labels must not be cropped.

### PDF
- generated with `jsPDF`;
- preserves selected A4/A5 size;
- current margins: 4 mm for A5 and 6 mm for A4;
- generated page-by-page from `.estimate-page` elements.

### Image / WhatsApp
- must be ONE continuous PNG, not page-sliced;
- uses 16 px white padding around all sides;
- uses native file sharing when supported;
- checks `navigator.canShare({ files })`;
- desktop fallback opens WhatsApp and downloads the PNG;
- 10-digit Indian mobile numbers are prefixed with `91`.

Do not fix one output path by breaking another. When shared DOM/CSS is changed, verify all affected paths.

## 12. Offline cache and backup

The app has:
- local offline cache helpers in `src/lib/offlineStorage.js`;
- Excel backup generation in `src/lib/excelBackup.js`;
- a scheduled Vercel API endpoint in `api/daily-backup.js`;
- Netlify and Vercel configuration files.

Do not assume "offline" means full offline write support; inspect the current implementation.

Server/API environment variables and browser `VITE_*` variables have different exposure rules. Never move server secrets into client code.

## 13. Performance and scope ceilings

Current code intentionally loads Product Master in two ranges (`0-999` and `1000-1999`) in key screens. Do not accidentally claim search covers an unlimited product set without inspecting this.

For large list/performance work:
- measure the actual bottleneck first;
- avoid introducing a new dependency unless needed;
- reuse current normalization/search helpers where practical;
- preserve mobile responsiveness.

## 14. Verification gate

For ordinary application changes, the minimum automated verification is:

```bash
npm run lint
npm run build
```

Only run these after dependencies are available. Do not automatically change package versions because installation fails in an environment.

For UI behavior, automated build/lint is not enough. Verify the affected flow in a browser.

For changes involving document state, manually cover the relevant matrix:

- create vs edit
- quotation vs estimate vs return
- stock-tracked vs non-stock item
- dimension-based vs quantity item
- client linked vs no client where applicable
- A4 vs A5 if output layout changed
- short vs long estimate if pagination/cropping changed

Before completion:
- review `git diff`;
- state exactly which commands/flows passed;
- call out anything unverified;
- never invent success.
