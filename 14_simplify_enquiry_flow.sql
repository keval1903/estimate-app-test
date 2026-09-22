BEGIN;

-- =============================================================================
-- Laminea Code Finder: simplified enquiry -> order workflow
-- NEW -> READY_TO_ORDER
-- NEW/READY_TO_ORDER -> AWAITING_CLIENT -> READY_TO_ORDER
-- READY_TO_ORDER -> ORDER_PLACED
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema and legacy-data migration
-- -----------------------------------------------------------------------------

ALTER TABLE public.code_finder_enquiries
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS order_placed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS order_idempotency_key TEXT;

-- The old constraint must be removed before writing the new status values.
ALTER TABLE public.code_finder_enquiries
    DROP CONSTRAINT IF EXISTS code_finder_enquiries_status_check;

UPDATE public.code_finder_enquiries
SET
    status = 'ORDER_PLACED',
    confirmed_at = COALESCE(confirmed_at, updated_at, created_at),
    order_placed_at = COALESCE(order_placed_at, updated_at, created_at)
WHERE status IN ('CONFIRMED', 'CONVERTED_TO_ESTIMATE');

UPDATE public.code_finder_enquiries
SET status = 'NEW'
WHERE status = 'UNDER_REVIEW';

UPDATE public.code_finder_enquiries
SET status = 'CANCELLED'
WHERE status = 'REJECTED';

ALTER TABLE public.code_finder_enquiries
    ADD CONSTRAINT code_finder_enquiries_status_check
    CHECK (status IN (
        'NEW',
        'AWAITING_CLIENT',
        'READY_TO_ORDER',
        'ORDER_PLACED',
        'CANCELLED'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS code_finder_enquiries_order_idempotency_idx
    ON public.code_finder_enquiries (
        code_finder_user_id,
        order_idempotency_key
    )
    WHERE order_idempotency_key IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 2. Notification routing
-- -----------------------------------------------------------------------------

ALTER TABLE public.notification_outbox
    ADD COLUMN IF NOT EXISTS target_user_id UUID
        REFERENCES auth.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS target_audience TEXT NOT NULL DEFAULT 'STAFF';

ALTER TABLE public.notification_outbox
    DROP CONSTRAINT IF EXISTS notification_outbox_event_type_check;

ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_event_type_check
    CHECK (event_type IN (
        'NEW_ENQUIRY',
        'NEW_MESSAGE',
        'PROPOSAL_RESPONSE',
        'ENQUIRY_CONFIRMED',
        'PROPOSAL_SUBMITTED',
        'ORDER_PLACED'
    ));

ALTER TABLE public.notification_outbox
    DROP CONSTRAINT IF EXISTS notification_outbox_target_check;

ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_target_check
    CHECK (
        (target_audience = 'STAFF' AND target_user_id IS NULL)
        OR
        (target_audience = 'USER' AND target_user_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS notification_outbox_target_user_idx
    ON public.notification_outbox(target_user_id)
    WHERE target_user_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. Push subscription endpoint ownership
-- -----------------------------------------------------------------------------

-- Keep the most recently useful row if old data contains the same browser
-- endpoint under more than one user.
WITH ranked_subscriptions AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY endpoint
            ORDER BY
                last_success_at DESC NULLS LAST,
                created_at DESC,
                id DESC
        ) AS row_number
    FROM public.push_subscriptions
)
DELETE FROM public.push_subscriptions ps
USING ranked_subscriptions ranked
WHERE ps.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_unique
    ON public.push_subscriptions(endpoint);


-- -----------------------------------------------------------------------------
-- 4. Retire the legacy generic transition workflow
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_enquiry_status(
    p_enquiry_id UUID,
    p_new_status TEXT,
    p_internal_note TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_status TEXT;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT status
    INTO v_current_status
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF p_new_status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION
            'Use confirm_code_finder_enquiry, submit_proposal, or place_code_finder_order for workflow transitions';
    END IF;

    IF v_current_status = 'CANCELLED' THEN
        RETURN;
    END IF;

    UPDATE public.code_finder_enquiries
    SET
        status = 'CANCELLED',
        internal_note = COALESCE(p_internal_note, internal_note),
        updated_at = NOW()
    WHERE id = p_enquiry_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.update_enquiry_status(UUID, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.update_enquiry_status(UUID, TEXT, TEXT)
TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. Staff confirms an enquiry
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_code_finder_enquiry(
    p_enquiry_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enquiry public.code_finder_enquiries%ROWTYPE;
    v_customer_auth_user_id UUID;
    v_has_unresolved_proposal BOOLEAN;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT *
    INTO v_enquiry
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF v_enquiry.status IS DISTINCT FROM 'NEW' THEN
        RAISE EXCEPTION 'Only NEW enquiries can be confirmed directly';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.code_finder_enquiry_items
        WHERE enquiry_id = p_enquiry_id
    ) THEN
        RAISE EXCEPTION 'Enquiry must contain at least one item';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.code_finder_proposals
        WHERE enquiry_id = p_enquiry_id
          AND superseded_at IS NULL
          AND response IS DISTINCT FROM 'ACCEPTED'
    )
    INTO v_has_unresolved_proposal;

    IF v_has_unresolved_proposal THEN
        RAISE EXCEPTION 'Resolve or replace the active proposal before confirming this enquiry';
    END IF;

    SELECT auth_user_id
    INTO v_customer_auth_user_id
    FROM public.code_finder_users
    WHERE id = v_enquiry.code_finder_user_id;

    IF v_customer_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'Code Finder customer account is unavailable';
    END IF;

    UPDATE public.code_finder_enquiries
    SET
        status = 'READY_TO_ORDER',
        confirmed_at = NOW(),
        confirmed_by = auth.uid(),
        updated_at = NOW()
    WHERE id = p_enquiry_id
    RETURNING * INTO v_enquiry;

    INSERT INTO public.notification_outbox (
        event_type,
        event_payload,
        notification_tag,
        next_retry_at,
        target_audience,
        target_user_id
    )
    VALUES (
        'ENQUIRY_CONFIRMED',
        jsonb_build_object(
            'enquiry_id', v_enquiry.id,
            'enquiry_number', v_enquiry.enquiry_number
        ),
        'enquiry-confirmed:' || v_enquiry.id,
        NOW(),
        'USER',
        v_customer_auth_user_id
    );

    RETURN jsonb_build_object(
        'enquiry_id', v_enquiry.id,
        'enquiry_number', v_enquiry.enquiry_number,
        'status', v_enquiry.status,
        'confirmed_at', v_enquiry.confirmed_at
    );
END;
$$;

REVOKE ALL
ON FUNCTION public.confirm_code_finder_enquiry(UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.confirm_code_finder_enquiry(UUID)
TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. Create/edit a proposal (old versions remain immutable history)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_proposal(
    p_enquiry_id UUID,
    p_type TEXT,
    p_staff_note TEXT,
    p_items JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enquiry public.code_finder_enquiries%ROWTYPE;
    v_next_revision INTEGER;
    v_proposal_id UUID;
    v_item JSONB;
    v_customer_auth_user_id UUID;
    v_expected_item_count INTEGER;
    v_distinct_item_count INTEGER;
BEGIN
    PERFORM public.cf8_require_staff();

    IF NULLIF(BTRIM(p_staff_note), '') IS NULL THEN
        RAISE EXCEPTION 'Customer-visible explanation is required';
    END IF;

    IF p_type IS NULL
       OR p_type NOT IN ('QUANTITY_PROPOSAL', 'CLARIFICATION') THEN
        RAISE EXCEPTION 'Invalid proposal type';
    END IF;

    SELECT *
    INTO v_enquiry
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF v_enquiry.status NOT IN ('NEW', 'READY_TO_ORDER', 'AWAITING_CLIENT') THEN
        RAISE EXCEPTION
            'Proposal can only be submitted for NEW, READY_TO_ORDER, or AWAITING_CLIENT enquiries';
    END IF;

    SELECT auth_user_id
    INTO v_customer_auth_user_id
    FROM public.code_finder_users
    WHERE id = v_enquiry.code_finder_user_id;

    IF v_customer_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'Code Finder customer account is unavailable';
    END IF;

    IF p_type = 'QUANTITY_PROPOSAL' THEN
        IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Proposal items must be an array';
        END IF;

        SELECT COUNT(*)
        INTO v_expected_item_count
        FROM public.code_finder_enquiry_items
        WHERE enquiry_id = p_enquiry_id;

        IF v_expected_item_count = 0
           OR jsonb_array_length(p_items) <> v_expected_item_count THEN
            RAISE EXCEPTION 'Include every enquiry item exactly once';
        END IF;

        SELECT COUNT(DISTINCT item->>'enquiry_item_id')
        INTO v_distinct_item_count
        FROM jsonb_array_elements(p_items) AS item;

        IF v_distinct_item_count <> v_expected_item_count THEN
            RAISE EXCEPTION 'Duplicate or missing enquiry item IDs';
        END IF;

        FOR v_item IN
            SELECT value FROM jsonb_array_elements(p_items)
        LOOP
            IF NULLIF(v_item->>'enquiry_item_id', '') IS NULL
               OR NULLIF(v_item->>'proposed_quantity', '') IS NULL THEN
                RAISE EXCEPTION 'Each proposal item requires an item ID and quantity';
            END IF;

            IF (v_item->>'proposed_quantity')::NUMERIC <= 0 THEN
                RAISE EXCEPTION 'Proposed quantities must be greater than zero';
            END IF;

            IF NOT EXISTS (
                SELECT 1
                FROM public.code_finder_enquiry_items
                WHERE id = (v_item->>'enquiry_item_id')::UUID
                  AND enquiry_id = p_enquiry_id
            ) THEN
                RAISE EXCEPTION 'Invalid enquiry item provided';
            END IF;
        END LOOP;
    END IF;

    SELECT COALESCE(MAX(revision), 0) + 1
    INTO v_next_revision
    FROM public.code_finder_proposals
    WHERE enquiry_id = p_enquiry_id;

    -- Exactly one proposal may be active for an enquiry. Editing creates a new
    -- version and preserves the previous version.
    UPDATE public.code_finder_proposals
    SET superseded_at = NOW()
    WHERE enquiry_id = p_enquiry_id
      AND superseded_at IS NULL;

    INSERT INTO public.code_finder_proposals (
        enquiry_id,
        revision,
        proposal_type,
        staff_note,
        submitted_by
    )
    VALUES (
        p_enquiry_id,
        v_next_revision,
        p_type,
        BTRIM(p_staff_note),
        auth.uid()
    )
    RETURNING id INTO v_proposal_id;

    IF p_type = 'QUANTITY_PROPOSAL' THEN
        FOR v_item IN
            SELECT value FROM jsonb_array_elements(p_items)
        LOOP
            INSERT INTO public.code_finder_proposal_items (
                proposal_id,
                enquiry_item_id,
                proposed_quantity,
                item_note
            )
            VALUES (
                v_proposal_id,
                (v_item->>'enquiry_item_id')::UUID,
                (v_item->>'proposed_quantity')::NUMERIC,
                NULLIF(BTRIM(v_item->>'item_note'), '')
            );
        END LOOP;
    END IF;

    UPDATE public.code_finder_enquiries
    SET
        status = 'AWAITING_CLIENT',
        confirmed_at = NULL,
        confirmed_by = NULL,
        updated_at = NOW()
    WHERE id = p_enquiry_id;

    INSERT INTO public.notification_outbox (
        event_type,
        event_payload,
        notification_tag,
        next_retry_at,
        target_audience,
        target_user_id
    )
    VALUES (
        'PROPOSAL_SUBMITTED',
        jsonb_build_object(
            'enquiry_id', p_enquiry_id,
            'proposal_id', v_proposal_id,
            'revision', v_next_revision
        ),
        'proposal-submitted:' || v_proposal_id,
        NOW(),
        'USER',
        v_customer_auth_user_id
    );
END;
$$;

REVOKE ALL
ON FUNCTION public.submit_proposal(UUID, TEXT, TEXT, JSONB)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.submit_proposal(UUID, TEXT, TEXT, JSONB)
TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. Customer responds to the latest proposal (Edge Function/service role)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.respond_to_proposal(
    p_proposal_id UUID,
    p_user_id UUID,
    p_response TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_proposal public.code_finder_proposals%ROWTYPE;
    v_enquiry public.code_finder_enquiries%ROWTYPE;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.code_finder_users
        WHERE id = p_user_id
          AND is_active IS TRUE
    ) THEN
        RAISE EXCEPTION 'Active customer required';
    END IF;

    IF p_response NOT IN ('ACCEPTED', 'REPLIED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid response';
    END IF;

    -- Always lock the enquiry first, then the proposal.
    SELECT enquiry.*
    INTO v_enquiry
    FROM public.code_finder_enquiries enquiry
    JOIN public.code_finder_proposals proposal
      ON proposal.enquiry_id = enquiry.id
    WHERE proposal.id = p_proposal_id
    FOR UPDATE OF enquiry;

    IF NOT FOUND OR v_enquiry.code_finder_user_id IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Enquiry unavailable';
    END IF;

    SELECT *
    INTO v_proposal
    FROM public.code_finder_proposals
    WHERE id = p_proposal_id
    FOR UPDATE;

    IF v_proposal.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION 'Proposal has been superseded';
    END IF;

    IF v_proposal.response = p_response
       AND v_proposal.responded_by = p_user_id THEN
        RETURN;
    END IF;

    IF v_enquiry.status IS DISTINCT FROM 'AWAITING_CLIENT'
       OR v_proposal.response IS NOT NULL THEN
        RAISE EXCEPTION 'Proposal cannot be answered in its current state';
    END IF;

    IF p_response = 'ACCEPTED'
       AND v_proposal.proposal_type IS DISTINCT FROM 'QUANTITY_PROPOSAL' THEN
        RAISE EXCEPTION 'Only a quantity proposal can be accepted';
    END IF;

    IF p_response = 'REPLIED'
       AND v_proposal.proposal_type IS DISTINCT FROM 'CLARIFICATION' THEN
        RAISE EXCEPTION 'Quantity proposals require explicit acceptance';
    END IF;

    UPDATE public.code_finder_proposals
    SET
        response = p_response,
        responded_by = p_user_id,
        responded_at = NOW()
    WHERE id = p_proposal_id;

    IF p_response = 'ACCEPTED' THEN
        UPDATE public.code_finder_enquiries
        SET
            status = 'READY_TO_ORDER',
            confirmed_at = NOW(),
            confirmed_by = v_proposal.submitted_by,
            updated_at = NOW()
        WHERE id = v_enquiry.id;
    ELSIF p_response = 'REPLIED' THEN
        UPDATE public.code_finder_enquiries
        SET
            status = 'NEW',
            updated_at = NOW()
        WHERE id = v_enquiry.id;
    ELSE
        UPDATE public.code_finder_enquiries
        SET
            status = 'CANCELLED',
            updated_at = NOW()
        WHERE id = v_enquiry.id;
    END IF;

    -- The existing notify_proposal_response trigger creates the staff outbox
    -- event from this proposal update.
END;
$$;

REVOKE ALL
ON FUNCTION public.respond_to_proposal(UUID, UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.respond_to_proposal(UUID, UUID, TEXT)
TO service_role;


-- -----------------------------------------------------------------------------
-- 8. Customer places an order
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.place_code_finder_order(
    p_enquiry_id UUID,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code_finder_user_id UUID;
    v_enquiry public.code_finder_enquiries%ROWTYPE;
    v_has_unresolved_proposal BOOLEAN;
BEGIN
    SELECT id
    INTO v_code_finder_user_id
    FROM public.code_finder_users
    WHERE auth_user_id = auth.uid()
      AND is_active IS TRUE;

    IF v_code_finder_user_id IS NULL THEN
        RAISE EXCEPTION 'Active Code Finder user required';
    END IF;

    IF NULLIF(BTRIM(p_idempotency_key), '') IS NULL
       OR LENGTH(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'Valid idempotency key required';
    END IF;

    SELECT *
    INTO v_enquiry
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF v_enquiry.code_finder_user_id IS DISTINCT FROM v_code_finder_user_id THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    IF v_enquiry.status = 'ORDER_PLACED'
       AND v_enquiry.order_idempotency_key = BTRIM(p_idempotency_key) THEN
        RETURN jsonb_build_object(
            'enquiry_id', v_enquiry.id,
            'enquiry_number', v_enquiry.enquiry_number,
            'status', v_enquiry.status,
            'order_placed_at', v_enquiry.order_placed_at,
            'duplicate', TRUE
        );
    END IF;

    IF v_enquiry.status IS DISTINCT FROM 'READY_TO_ORDER' THEN
        RAISE EXCEPTION 'Enquiry must be READY_TO_ORDER before placing an order';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.code_finder_proposals
        WHERE enquiry_id = p_enquiry_id
          AND superseded_at IS NULL
          AND response IS DISTINCT FROM 'ACCEPTED'
    )
    INTO v_has_unresolved_proposal;

    IF v_has_unresolved_proposal THEN
        RAISE EXCEPTION 'Cannot place an order while a proposal is unresolved';
    END IF;

    UPDATE public.code_finder_enquiries
    SET
        status = 'ORDER_PLACED',
        order_placed_at = NOW(),
        order_idempotency_key = BTRIM(p_idempotency_key),
        updated_at = NOW()
    WHERE id = p_enquiry_id
    RETURNING * INTO v_enquiry;

    INSERT INTO public.notification_outbox (
        event_type,
        event_payload,
        notification_tag,
        next_retry_at,
        target_audience,
        target_user_id
    )
    VALUES (
        'ORDER_PLACED',
        jsonb_build_object(
            'enquiry_id', v_enquiry.id,
            'enquiry_number', v_enquiry.enquiry_number
        ),
        'order-placed:' || v_enquiry.id,
        NOW(),
        'STAFF',
        NULL
    );

    RETURN jsonb_build_object(
        'enquiry_id', v_enquiry.id,
        'enquiry_number', v_enquiry.enquiry_number,
        'status', v_enquiry.status,
        'order_placed_at', v_enquiry.order_placed_at,
        'duplicate', FALSE
    );
END;
$$;

REVOKE ALL
ON FUNCTION public.place_code_finder_order(UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.place_code_finder_order(UUID, TEXT)
TO authenticated;


-- -----------------------------------------------------------------------------
-- 9. Bind/unbind the current browser push subscription
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bind_push_subscription(
    p_endpoint TEXT,
    p_keys_p256dh TEXT,
    p_keys_auth TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NULLIF(BTRIM(p_endpoint), '') IS NULL
       OR NULLIF(BTRIM(p_keys_p256dh), '') IS NULL
       OR NULLIF(BTRIM(p_keys_auth), '') IS NULL THEN
        RAISE EXCEPTION 'Complete push subscription details are required';
    END IF;

    INSERT INTO public.push_subscriptions (
        user_id,
        endpoint,
        keys_p256dh,
        keys_auth
    )
    VALUES (
        v_user_id,
        BTRIM(p_endpoint),
        BTRIM(p_keys_p256dh),
        BTRIM(p_keys_auth)
    )
    ON CONFLICT (endpoint)
    DO UPDATE SET
        user_id = EXCLUDED.user_id,
        keys_p256dh = EXCLUDED.keys_p256dh,
        keys_auth = EXCLUDED.keys_auth,
        failure_count = 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.unbind_push_subscription(
    p_endpoint TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    DELETE FROM public.push_subscriptions
    WHERE endpoint = p_endpoint
      AND user_id = auth.uid();
END;
$$;

REVOKE ALL
ON FUNCTION public.bind_push_subscription(TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.unbind_push_subscription(TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.bind_push_subscription(TEXT, TEXT, TEXT)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.unbind_push_subscription(TEXT)
TO authenticated;


-- -----------------------------------------------------------------------------
-- 10. Clarification replies must never restore UNDER_REVIEW
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cf8_clarification_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_proposal_id UUID;
BEGIN
    IF NEW.sender_type <> 'CLIENT' OR NEW.enquiry_id IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM 1
    FROM public.code_finder_enquiries
    WHERE id = NEW.enquiry_id
      AND code_finder_user_id = NEW.code_finder_user_id
      AND status = 'AWAITING_CLIENT'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT id
    INTO v_proposal_id
    FROM public.code_finder_proposals
    WHERE enquiry_id = NEW.enquiry_id
      AND proposal_type = 'CLARIFICATION'
      AND superseded_at IS NULL
      AND response IS NULL
    FOR UPDATE;

    IF FOUND THEN
        UPDATE public.code_finder_proposals
        SET
            response = 'REPLIED',
            responded_at = NOW(),
            responded_by = NEW.code_finder_user_id
        WHERE id = v_proposal_id;

        UPDATE public.code_finder_enquiries
        SET
            status = 'NEW',
            updated_at = NOW()
        WHERE id = NEW.enquiry_id;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.cf8_clarification_reply()
FROM PUBLIC, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 11. Estimate creation is allowed only after the customer places the order
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_estimate_from_enquiry(
    p_enquiry_id UUID,
    p_idempotency_key UUID,
    p_platform TEXT,
    p_doc_type TEXT,
    p_bill_date TEXT,
    p_client_id UUID,
    p_client_name TEXT,
    p_client_mobile TEXT,
    p_prepared_by TEXT,
    p_order_by TEXT,
    p_site_name TEXT,
    p_totals JSONB,
    p_items JSONB,
    p_previous_balance NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enquiry RECORD;
    v_has_unresolved BOOLEAN;
    v_est_result JSONB;
    v_item JSONB;
    v_resolved JSONB;
    v_expected JSONB;
    v_est_id UUID;
    v_type TEXT;
    v_normalized_items JSONB := '[]'::jsonb;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT * INTO v_enquiry
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF v_enquiry.status <> 'ORDER_PLACED' THEN
        RAISE EXCEPTION 'The customer must place the order before an estimate can be created';
    END IF;

    IF p_platform IS DISTINCT FROM 'laminea' OR p_doc_type IS DISTINCT FROM 'ESTIMATE' THEN
        RAISE EXCEPTION 'This operation creates Laminea estimates only';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.code_finder_users customer
        JOIN public.clients client
          ON client.id = customer.laminea_client_id
        WHERE customer.id = v_enquiry.code_finder_user_id
          AND client.id = p_client_id
          AND client.platform = 'laminea'
    ) THEN
        RAISE EXCEPTION 'Link the customer to the correct Laminea client first';
    END IF;

    IF v_enquiry.converted_estimate_id IS NOT NULL THEN
        SELECT type
        INTO v_type
        FROM public.estimates
        WHERE id = v_enquiry.converted_estimate_id;

        IF v_type IS DISTINCT FROM 'ESTIMATE' THEN
            RAISE EXCEPTION 'Existing linked document requires internal review; do not create another';
        END IF;

        RETURN jsonb_build_object(
            'success', TRUE,
            'estimate_id', v_enquiry.converted_estimate_id,
            'duplicate', TRUE
        );
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.code_finder_proposals
        WHERE enquiry_id = p_enquiry_id
          AND superseded_at IS NULL
          AND response IS DISTINCT FROM 'ACCEPTED'
    )
    INTO v_has_unresolved;

    IF v_has_unresolved THEN
        RAISE EXCEPTION 'Cannot convert an enquiry with an unresolved proposal';
    END IF;

    PERFORM mapping.id
    FROM public.laminea_product_codes mapping
    JOIN public.code_finder_enquiry_items item
      ON public.normalize_alternative_code(item.alternative_code_snapshot)
       = public.normalize_alternative_code(mapping.alternative_code)
    WHERE item.enquiry_id = p_enquiry_id
    ORDER BY mapping.id
    FOR SHARE OF mapping;

    PERFORM product.id
    FROM public.products product
    WHERE product.id IN (
        SELECT mapping.product_id
        FROM public.laminea_product_codes mapping
        JOIN public.code_finder_enquiry_items item
          ON public.normalize_alternative_code(item.alternative_code_snapshot)
           = public.normalize_alternative_code(mapping.alternative_code)
        WHERE item.enquiry_id = p_enquiry_id
    )
    ORDER BY product.id
    FOR NO KEY UPDATE;

    v_resolved := public.resolve_enquiry_items(p_enquiry_id);

    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
       OR v_resolved IS NULL THEN
        RAISE EXCEPTION 'Estimate items required';
    END IF;

    IF jsonb_array_length(p_items) <> jsonb_array_length(v_resolved) THEN
        RAISE EXCEPTION 'Include every agreed enquiry item once';
    END IF;

    IF (
        SELECT COUNT(DISTINCT item->>'enquiry_item_id')
        FROM jsonb_array_elements(p_items) item
    ) <> jsonb_array_length(p_items) THEN
        RAISE EXCEPTION 'Duplicate or missing enquiry item IDs';
    END IF;

    FOR v_item IN
        SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        SELECT expected
        INTO v_expected
        FROM jsonb_array_elements(v_resolved) expected
        WHERE expected->>'enquiry_item_id' = v_item->>'enquiry_item_id';

        IF v_expected IS NULL
           OR v_expected->>'current_product_name' IS NULL
           OR (v_expected->>'is_disabled')::BOOLEAN
           OR (v_expected->>'is_reassigned')::BOOLEAN
           OR v_expected->>'product_id_snapshot' IS NULL
           OR (v_expected->>'was_not_found')::BOOLEAN THEN
            RAISE EXCEPTION
                'Missing historical mapping or changed/ineligible code: resolve internally before conversion';
        END IF;

        IF v_item->>'product_id' IS DISTINCT FROM v_expected->>'current_product_id'
           OR public.normalize_alternative_code(v_item->>'alternative_code_snapshot')
              IS DISTINCT FROM
              public.normalize_alternative_code(v_expected->>'alternative_code_snapshot')
           OR v_item->>'calculation_type_snapshot'
              IS DISTINCT FROM v_expected->>'current_calculation_type'
           OR (
                CASE
                    WHEN v_expected->>'current_calculation_type' IN ('SQFT', 'INCH', 'FEET')
                        THEN (v_item->>'nos')::NUMERIC
                    ELSE (v_item->>'quantity')::NUMERIC
                END
              ) IS DISTINCT FROM (v_expected->>'agreed_quantity')::NUMERIC THEN
            RAISE EXCEPTION 'Estimate item differs from the agreed enquiry';
        END IF;

        SELECT jsonb_set(
            v_item,
            '{alternative_code_snapshot}',
            to_jsonb(mapping.alternative_code)
        )
        INTO v_item
        FROM public.laminea_product_codes mapping
        WHERE public.normalize_alternative_code(mapping.alternative_code)
              = public.normalize_alternative_code(
                    v_expected->>'alternative_code_snapshot'
                )
          AND mapping.is_active;

        IF v_item IS NULL THEN
            RAISE EXCEPTION 'Mapping unavailable';
        END IF;

        v_normalized_items :=
            v_normalized_items || jsonb_build_array(v_item);
    END LOOP;

    v_est_result := public.process_estimate_atomic(
        p_action => 'SAVE',
        p_estimate_id => NULL,
        p_platform => p_platform,
        p_doc_type => p_doc_type,
        p_bill_date => p_bill_date,
        p_client_name => p_client_name,
        p_prepared_by => p_prepared_by,
        p_totals => p_totals,
        p_items => v_normalized_items,
        p_client_id => p_client_id,
        p_client_mobile => p_client_mobile,
        p_order_by => p_order_by,
        p_site_name => p_site_name,
        p_previous_balance => p_previous_balance,
        p_idempotency_key => p_idempotency_key
    );

    IF (v_est_result->>'success') IS DISTINCT FROM 'true'
       OR v_est_result->>'estimate_id' IS NULL THEN
        RAISE EXCEPTION 'Estimate save failed; transaction rolled back';
    END IF;

    v_est_id := (v_est_result->>'estimate_id')::UUID;

    IF NOT EXISTS (
        SELECT 1
        FROM public.estimates
        WHERE id = v_est_id
          AND platform = 'laminea'
          AND client_id = p_client_id
          AND type = 'ESTIMATE'
    ) THEN
        RAISE EXCEPTION 'Unexpected estimate returned by existing RPC';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.code_finder_enquiries
        WHERE converted_estimate_id = v_est_id
          AND id <> p_enquiry_id
    ) THEN
        RAISE EXCEPTION 'Estimate already linked to another enquiry';
    END IF;

    UPDATE public.code_finder_enquiries
    SET converted_estimate_id = v_est_id
    WHERE id = p_enquiry_id;

    -- Deliberately keep the customer-visible status as ORDER_PLACED.
    RETURN v_est_result;
END;
$$;

REVOKE ALL
ON FUNCTION public.create_estimate_from_enquiry(
    UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT,
    TEXT, TEXT, TEXT, JSONB, JSONB, NUMERIC
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.create_estimate_from_enquiry(
    UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT,
    TEXT, TEXT, TEXT, JSONB, JSONB, NUMERIC
)
TO authenticated;

COMMIT;
