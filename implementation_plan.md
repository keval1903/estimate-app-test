# Simplify Code Finder Enquiry-to-Order Flow

This implementation plan details the architectural and code changes necessary to simplify the enquiry workflow, moving to a direct `NEW` -> `READY_TO_ORDER` (or `AWAITING_CLIENT` via proposals) -> `ORDER_PLACED` state machine.

## Proposed Changes

### 1. Database Migrations & Safety Rules

#### [NEW] `14_simplify_enquiry_flow.sql`
A single, idempotent migration script to update the database schema and RPCs safely:
- **Data Migration**: Map existing statuses (`UNDER_REVIEW` -> `NEW`, `CONFIRMED` -> `ORDER_PLACED`, `CONVERTED_TO_ESTIMATE` -> `ORDER_PLACED`, `REJECTED` -> `CANCELLED`).
  - *Timestamp Backfilling*: During migration, set `confirmed_at = COALESCE(confirmed_at, updated_at, created_at)` and `order_placed_at = COALESCE(order_placed_at, updated_at, created_at)` for existing `CONFIRMED` and `CONVERTED_TO_ESTIMATE` rows so they display properly.
- **Schema Updates**: 
  - Re-create the `code_finder_enquiries_status_check` constraint with exactly the allowed statuses: `NEW`, `AWAITING_CLIENT`, `READY_TO_ORDER`, `ORDER_PLACED`, `CANCELLED`.
  - Add missing columns: `confirmed_at`, `confirmed_by`, `order_placed_at`, `order_idempotency_key`.
  - Create a unique index for idempotency: `CREATE UNIQUE INDEX ... ON public.code_finder_enquiries (code_finder_user_id, order_idempotency_key) WHERE order_idempotency_key IS NOT NULL;`
- **`UNDER_REVIEW` Removal**: Remove `UNDER_REVIEW` from all active constraints, transitions, triggers, APIs and UI logic while preserving historical audit/proposal records.

#### Stock & Privacy Rules
- Confirming an enquiry does *not* reserve or deduct stock.
- Placing an order does *not* reserve or deduct stock.
- Stock is deducted only during internal estimate creation.
- Existing live, non-cached availability checking remains unchanged.
- Client APIs must *never* return `converted_estimate_id`, estimate numbers, internal notes, actual codes, product IDs, or stock counts.

### 2. Core RPCs & Edge API Filters

#### Security Requirements
- **Atomic Execution**: Notifications and status changes must occur in the same transaction.
- **Locking**: `FOR UPDATE` row locking must be used in all status transitions.
- **Ownership**: Customer ownership validation using `auth.uid()` and active Code Finder account validation are required.

#### RPC Updates
- **`confirm_code_finder_enquiry`**: Transitions `NEW` to `READY_TO_ORDER`, sets `confirmed_at`/`confirmed_by`.
- **`submit_proposal`**: Accepts proposals from `NEW`, `READY_TO_ORDER`, and `AWAITING_CLIENT`. Transitions to `AWAITING_CLIENT`.
- **`respond_to_proposal`**: 
  - Transitions status directly to `READY_TO_ORDER` upon customer acceptance.
  - Only the latest non-superseded proposal can be accepted. Accepted/superseded proposals cannot be accepted again.
- **`place_code_finder_order`**: 
  - Transitions `READY_TO_ORDER` to `ORDER_PLACED`. 
  - Rejects unresolved proposals.
  - Returns the existing successful result (enquiry data) if the same idempotency key is retried by the same user instead of failing.
- **`create_estimate_from_enquiry`**: 
  - Strictly requires `ORDER_PLACED`.
  - Reverting or deleting an estimate leaves customer status as `ORDER_PLACED`.

#### Edge API Filters
- **`client-enquiries` API**: Must filter to return only `NEW`, `AWAITING_CLIENT`, and `READY_TO_ORDER`.
- **`client-orders` API**: Must filter to return only `ORDER_PLACED`.

---

### 3. Main Laminea App (Staff Frontend)

#### [MODIFY] `src/pages/CustomerDetail.jsx`
- Update the Enquiries tab logic to handle `NEW`, `AWAITING_CLIENT`, and `READY_TO_ORDER` statuses.
- **`NEW` State**: Show only "Confirm" and "Propose Changes" buttons.
- **`AWAITING_CLIENT` State**: 
  - Implement the "Edit Proposal" button. It will prefill the latest active proposal quantities and note, display its version number, preserve previous versions in staff proposal history, notify the customer, and create a new version via `submit_proposal`.
- **`READY_TO_ORDER` State**:
  - Show "Confirmed — Waiting for Customer" and "Propose Changes". 
  - If Propose Changes is used here, create a new proposal and move the enquiry back to `AWAITING_CLIENT`.
- **Orders & History**: 
  - Move only `ORDER_PLACED` items to the Orders tab.
  - Move `CANCELLED` items to archived/cancelled history, not the Orders tab.
- **Create Estimate**: 
  - Only appears on `ORDER_PLACED`. 
  - Requires a valid `laminea_client_id` (platform = 'laminea'). If missing, show the Link/Create Laminea Client interface before opening the estimate form.

#### [MODIFY] `src/pages/CustomerEnquiries.jsx`
- Update pending counts and filters (`NEW`, `AWAITING_CLIENT`, `READY_TO_ORDER`).
- Completely remove any visual references to `UNDER_REVIEW` and `REJECTED`.

---

### 4. Code Finder Client Portal

#### [MODIFY] `code-finder/src/pages/Enquiries.jsx`
- Update the list to map statuses to user-friendly labels (Submitted, Changes Proposed, Confirmed - Ready to Order).

#### [MODIFY] `code-finder/src/pages/EnquiryDetail.jsx`
- Rebuild the status logic without `UNDER_REVIEW`.
- For `AWAITING_CLIENT`, show only the most recent active (non-superseded) proposal.
- For `READY_TO_ORDER`, show the new "Place Order" confirmation modal.
- **Order Placement Idempotency**: 
  - Generate a stable idempotency key on mount (e.g., `const storageKey = place-order-key:${enquiryId}`) and store it in `sessionStorage` or `localStorage` to survive rerenders/refreshes.
  - Delete it only after confirmed API success.

#### [MODIFY] `code-finder/src/pages/Orders.jsx`
- Update filters so ONLY `ORDER_PLACED` enquiries are visible here (`READY_TO_ORDER` and `CANCELLED` will be excluded).

---

### 5. Notification Routing & Push Persistence

#### Push Persistence Lifecycle
- **Endpoints**: Create secure API routes (`POST /api/push-subscription` and `DELETE /api/push-subscription`) for the Code Finder app to proxy the HTTP-only cookie authentication into the RPC. The API MUST derive the user from the HttpOnly session and never accept an arbitrary `user_id` from the browser.
- **Uniqueness**: The push endpoint must be globally unique.
- **Rebinding**: Existing subscription must be rebound on every login. If another user logs into the same device, the endpoint must be reassigned securely.
- **Logout**: Logout must do nothing to the subscription.
- **Disable**: Manual "Disable Notifications" action deletes only that device’s subscription and then calls `unsubscribe()`.

#### Notification Routing & Payloads
- **Staff -> Customer Notifications (Target: `auth_user_id` of Customer)**
  - Event: Staff confirms enquiry (`READY_TO_ORDER`)
  - Event: Staff submits proposal (`AWAITING_CLIENT`)
  - Event: Staff edits proposal (`AWAITING_CLIENT`)
  - Code Finder must register its own service worker and subscription to receive these.
- **Customer -> Staff Notifications (Target: Eligible ADMIN/STAFF users)**
  - Event: Customer accepts proposal
  - Event: Customer places order (`ORDER_PLACED`)
- All database RPCs performing these actions will insert directly into `notification_outbox` in the same transaction.

## User Review Required

The plan is fully complete and matches the agreed flow. Awaiting final approval to proceed with execution.

## Verification Plan

### Manual Verification
1. I will log in as a Staff member and verify the new `CustomerDetail` buttons.
2. I will log in as a Customer, submit an enquiry, and verify that the Staff member can instantly "Confirm" it.
3. I will verify that the "Place Order" flow strictly uses `sessionStorage` idempotency keys and successfully updates the status to `ORDER_PLACED`.
4. I will test the "Propose Changes" flow from both `NEW` and `READY_TO_ORDER` to ensure it loops back to `AWAITING_CLIENT` and properly tracks proposal versions.
