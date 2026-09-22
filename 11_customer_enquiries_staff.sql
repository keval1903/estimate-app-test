-- Phase 8 v4 corrected migration. Run ONCE, in staging first.
-- Replaces the unrun draft; aborts if its proposal tables already exist.
-- Does not replace process_estimate_atomic or change stock directly.
-- Frontend/Edge changes listed at end are required before enabling Phase 8.
BEGIN;
DO $$
BEGIN
 IF to_regclass('public.code_finder_proposals') IS NOT NULL THEN
  RAISE EXCEPTION 'Phase 8 tables already exist. Do not rerun; use a schema-specific upgrade.';
 END IF;
 IF to_regprocedure('public.process_estimate_atomic(text,uuid,uuid,text,text,integer,text,uuid,text,text,text,text,text,jsonb,jsonb,numeric)') IS NULL THEN
  RAISE EXCEPTION 'Expected estimate RPC signature missing; transaction aborted.';
 END IF;
 IF to_regprocedure('public.normalize_alternative_code(text)') IS NULL THEN
  RAISE EXCEPTION 'Alternative-code normalization function missing.';
 END IF;
END $$;
CREATE FUNCTION public.cf8_require_staff() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.user_roles
 WHERE id=auth.uid() AND is_active IS TRUE AND role IN ('ADMIN','STAFF'))
 OR public.is_active_staff() IS DISTINCT FROM TRUE THEN
 RAISE EXCEPTION 'Active internal staff access required'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.cf8_require_staff() FROM PUBLIC, anon, authenticated;
ALTER TABLE public.code_finder_enquiries ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
-- Historical confirmation times are unknown; deliberately do not invent them.


-- 1. Safely update any existing 'CONVERTED_TO_ESTIMATE' statuses to 'CONFIRMED'
UPDATE public.code_finder_enquiries
SET status = 'CONFIRMED'
WHERE status = 'CONVERTED_TO_ESTIMATE';

-- 2. Strictly decouple internal document lifecycle from customer status
ALTER TABLE public.code_finder_enquiries
DROP CONSTRAINT IF EXISTS code_finder_enquiries_status_check;

ALTER TABLE public.code_finder_enquiries
ADD CONSTRAINT code_finder_enquiries_status_check
CHECK (status IN ('NEW', 'UNDER_REVIEW', 'AWAITING_CLIENT', 'CONFIRMED', 'REJECTED', 'CANCELLED'));

-- 3. Mapping Snapshot at Enquiry Submission
ALTER TABLE public.code_finder_enquiry_items
ADD COLUMN IF NOT EXISTS product_id_snapshot UUID REFERENCES public.products(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS product_code_snapshot TEXT,
ADD COLUMN IF NOT EXISTS mapping_revision_at TIMESTAMPTZ;

-- 4. Versioned Proposal History
CREATE TABLE public.code_finder_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enquiry_id UUID NOT NULL REFERENCES public.code_finder_enquiries(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    proposal_type TEXT NOT NULL CHECK (proposal_type IN ('QUANTITY_PROPOSAL', 'CLARIFICATION')),
    staff_note TEXT CHECK (staff_note IS NULL OR LENGTH(staff_note) <= 1000),
    submitted_by UUID NOT NULL REFERENCES auth.users(id),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    superseded_at TIMESTAMPTZ,
    responded_by UUID REFERENCES public.code_finder_users(id),
    response TEXT CHECK (response IS NULL OR response IN ('ACCEPTED', 'REPLIED', 'CANCELLED')),
    responded_at TIMESTAMPTZ,
    UNIQUE (enquiry_id, revision)
);

CREATE TABLE public.code_finder_proposal_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES public.code_finder_proposals(id) ON DELETE CASCADE,
    enquiry_item_id UUID NOT NULL REFERENCES public.code_finder_enquiry_items(id) ON DELETE CASCADE,
    proposed_quantity NUMERIC(12,2) NOT NULL CHECK (proposed_quantity > 0 AND proposed_quantity <> 'NaN'::numeric),
    UNIQUE (proposal_id, enquiry_item_id),
    item_note TEXT CHECK (item_note IS NULL OR LENGTH(item_note) <= 500)
);

CREATE INDEX code_finder_proposals_enquiry_idx ON public.code_finder_proposals(enquiry_id, revision DESC);

-- 5. Staff Read Tracking
CREATE TABLE public.code_finder_enquiry_reads (
    enquiry_id UUID NOT NULL REFERENCES public.code_finder_enquiries(id) ON DELETE CASCADE,
    staff_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (enquiry_id, staff_user_id)
);

CREATE TABLE public.code_finder_message_reads (
    code_finder_user_id UUID NOT NULL REFERENCES public.code_finder_users(id) ON DELETE CASCADE,
    staff_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    last_read_message_created_at TIMESTAMPTZ,
    last_read_message_id UUID REFERENCES public.code_finder_messages(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (code_finder_user_id, staff_user_id)
);

-- 6. Notification Outbox with Atomic Claiming
CREATE TABLE public.notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL CHECK (event_type IN ('NEW_ENQUIRY', 'NEW_MESSAGE', 'PROPOSAL_RESPONSE')),
    event_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    processing_lease_until TIMESTAMPTZ,
    notification_tag TEXT
);

CREATE INDEX notification_outbox_pending_idx
ON public.notification_outbox(next_retry_at)
WHERE processed_at IS NULL;

CREATE TABLE public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_success_at TIMESTAMPTZ,
    failure_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, endpoint)
);

CREATE TABLE public.push_delivery_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outbox_id UUID NOT NULL REFERENCES public.notification_outbox(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'EXPIRED')),
    UNIQUE (outbox_id, subscription_id)
);

-- 7. RLS and Grants
ALTER TABLE public.code_finder_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_finder_proposal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_finder_enquiry_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_finder_message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Read-only business data
GRANT SELECT ON public.code_finder_enquiries TO authenticated;
GRANT SELECT ON public.code_finder_enquiry_items TO authenticated;
GRANT SELECT ON public.code_finder_messages TO authenticated;
GRANT SELECT ON public.code_finder_users TO authenticated;
GRANT SELECT ON public.code_finder_proposals TO authenticated;
GRANT SELECT ON public.code_finder_proposal_items TO authenticated;

-- Message Insert
GRANT INSERT ON public.code_finder_messages TO authenticated;

-- Tracking mutations
GRANT SELECT, INSERT, UPDATE ON public.code_finder_enquiry_reads TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.code_finder_message_reads TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;

-- Policies
CREATE POLICY "staff_read_enquiries" ON public.code_finder_enquiries FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_read_items" ON public.code_finder_enquiry_items FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_read_users" ON public.code_finder_users FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_read_proposals" ON public.code_finder_proposals FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_read_proposal_items" ON public.code_finder_proposal_items FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_read_messages" ON public.code_finder_messages FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_send_messages" ON public.code_finder_messages FOR INSERT TO authenticated
    WITH CHECK (
        sender_type = 'STAFF' 
        AND sender_auth_user_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF'))
    );

CREATE POLICY "own_enquiry_reads" ON public.code_finder_enquiry_reads FOR ALL TO authenticated
    USING (staff_user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')))
WITH CHECK (staff_user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "own_message_reads" ON public.code_finder_message_reads FOR ALL TO authenticated
    USING (staff_user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')))
WITH CHECK (staff_user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "own_push_subs" ON public.push_subscriptions FOR ALL TO authenticated
    USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')))
WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));


-- 8. Core RPCs

-- update_enquiry_status
CREATE OR REPLACE FUNCTION public.update_enquiry_status(p_enquiry_id UUID, p_new_status TEXT, p_internal_note TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_status TEXT;
    v_has_unresolved BOOLEAN;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT status INTO v_current_status
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF p_new_status IS NULL THEN RAISE EXCEPTION 'Status required'; END IF;
    IF p_new_status = 'AWAITING_CLIENT' THEN
      RAISE EXCEPTION 'Use submit_proposal to send a clarification or proposal';
    END IF;
    IF p_new_status = 'CONFIRMED' THEN
        -- Block if there are unresolved quantity proposals
        SELECT EXISTS (
            SELECT 1 FROM public.code_finder_proposals
            WHERE enquiry_id = p_enquiry_id
              AND proposal_type = 'QUANTITY_PROPOSAL'
              AND superseded_at IS NULL AND response IS DISTINCT FROM 'ACCEPTED'
        ) INTO v_has_unresolved;

        IF v_has_unresolved THEN
            RAISE EXCEPTION 'Cannot confirm enquiry with an unresolved quantity proposal.';
        END IF;
    END IF;

    IF v_current_status = 'NEW' AND p_new_status NOT IN ('UNDER_REVIEW', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid transition from NEW to %', p_new_status;
    END IF;

    IF v_current_status = 'UNDER_REVIEW' AND p_new_status NOT IN ('AWAITING_CLIENT', 'CONFIRMED', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid transition from UNDER_REVIEW to %', p_new_status;
    END IF;

    IF v_current_status = 'AWAITING_CLIENT' AND p_new_status NOT IN ('UNDER_REVIEW', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid transition from AWAITING_CLIENT to %', p_new_status;
    END IF;

    IF v_current_status = 'CONFIRMED' AND p_new_status NOT IN ('CANCELLED') THEN
        RAISE EXCEPTION 'Invalid transition from CONFIRMED to %', p_new_status;
    END IF;

    IF v_current_status IN ('REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Terminal status cannot be changed.';
    END IF;

    UPDATE public.code_finder_enquiries
    SET status = p_new_status,
        confirmed_at = CASE WHEN p_new_status = 'CONFIRMED' THEN NOW() ELSE confirmed_at END,
        internal_note = COALESCE(p_internal_note, internal_note),
        updated_at = NOW()
    WHERE id = p_enquiry_id;
END;
$$;
REVOKE ALL ON FUNCTION public.update_enquiry_status(UUID, TEXT, TEXT) FROM PUBLIC, anon;

-- submit_proposal
CREATE OR REPLACE FUNCTION public.submit_proposal(p_enquiry_id UUID, p_type TEXT, p_staff_note TEXT, p_items JSONB DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_next_rev INTEGER;
    v_proposal_id UUID;
    v_item RECORD;
BEGIN
    PERFORM public.cf8_require_staff();

    IF NULLIF(BTRIM(p_staff_note), '') IS NULL THEN
      RAISE EXCEPTION 'Customer-visible explanation required';
    END IF;
    IF p_type IS NULL OR p_type NOT IN ('QUANTITY_PROPOSAL', 'CLARIFICATION') THEN
        RAISE EXCEPTION 'Invalid proposal type';
    END IF;

    SELECT status INTO v_status
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF v_status <> 'UNDER_REVIEW' THEN
        RAISE EXCEPTION 'Enquiry must be UNDER_REVIEW to submit a proposal';
    END IF;

    SELECT COALESCE(MAX(revision), 0) + 1 INTO v_next_rev
    FROM public.code_finder_proposals
    WHERE enquiry_id = p_enquiry_id;

    -- Retain history; unresolved superseded versions no longer block confirmation.
    UPDATE public.code_finder_proposals SET superseded_at=NOW()
 WHERE enquiry_id=p_enquiry_id AND superseded_at IS NULL AND proposal_type=p_type;
    INSERT INTO public.code_finder_proposals (enquiry_id, revision, proposal_type, staff_note, submitted_by)
    VALUES (p_enquiry_id, v_next_rev, p_type, p_staff_note, auth.uid())
    RETURNING id INTO v_proposal_id;

    IF p_type = 'QUANTITY_PROPOSAL' THEN
        IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
            RAISE EXCEPTION 'Items must be an array';
        END IF;
        IF jsonb_array_length(p_items) = 0 THEN
            RAISE EXCEPTION 'Quantity proposal requires items';
        END IF;

        -- Each version is a complete quantity proposal, not a partial delta.
        IF jsonb_array_length(p_items) <> (SELECT count(*) FROM public.code_finder_enquiry_items WHERE enquiry_id=p_enquiry_id) THEN
          RAISE EXCEPTION 'Include every enquiry item exactly once';
        END IF;
        FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.code_finder_enquiry_items 
                WHERE id = (v_item.value->>'enquiry_item_id')::UUID 
                  AND enquiry_id = p_enquiry_id
            ) THEN
                RAISE EXCEPTION 'Invalid enquiry item provided';
            END IF;

            INSERT INTO public.code_finder_proposal_items (proposal_id, enquiry_item_id, proposed_quantity, item_note)
            VALUES (
                v_proposal_id, 
                (v_item.value->>'enquiry_item_id')::UUID, 
                (v_item.value->>'proposed_quantity')::NUMERIC,
                v_item.value->>'item_note'
            );
        END LOOP;
    END IF;

    UPDATE public.code_finder_enquiries
    SET status = 'AWAITING_CLIENT',
        updated_at = NOW()
    WHERE id = p_enquiry_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_proposal(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;

-- respond_to_proposal (Service Role / Edge function only)
CREATE OR REPLACE FUNCTION public.respond_to_proposal(p_proposal_id UUID, p_user_id UUID, p_response TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_proposal RECORD;
    v_enquiry RECORD;
    v_max_rev INTEGER;
BEGIN
    IF p_user_id IS NULL OR p_response IS NULL OR NOT EXISTS
      (SELECT 1 FROM public.code_finder_users WHERE id=p_user_id AND is_active IS TRUE) THEN
      RAISE EXCEPTION 'Active customer required';
    END IF;
    -- Always lock enquiry before proposal, consistent with staff operations.
    SELECT e.* INTO v_enquiry FROM public.code_finder_enquiries e
    JOIN public.code_finder_proposals p ON p.enquiry_id=e.id
    WHERE p.id=p_proposal_id FOR UPDATE OF e;
    IF NOT FOUND OR v_enquiry.code_finder_user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Enquiry unavailable';
    END IF;
    SELECT * INTO v_proposal FROM public.code_finder_proposals WHERE id=p_proposal_id FOR UPDATE;
    IF v_proposal.superseded_at IS NOT NULL THEN RAISE EXCEPTION 'Proposal superseded'; END IF;
    IF v_proposal.response = p_response AND v_proposal.responded_by = p_user_id THEN RETURN; END IF;
    IF v_enquiry.status NOT IN ('AWAITING_CLIENT','UNDER_REVIEW') OR v_proposal.response IS NOT NULL THEN
      RAISE EXCEPTION 'Proposal cannot be answered in its current state';
    END IF;
    IF p_response='REPLIED' AND v_proposal.proposal_type='QUANTITY_PROPOSAL' THEN
      RAISE EXCEPTION 'Send a chat message; a quantity proposal requires explicit acceptance';
    END IF;
    IF p_response = 'ACCEPTED' AND v_proposal.proposal_type <> 'QUANTITY_PROPOSAL' THEN
        RAISE EXCEPTION 'Cannot ACCEPT a clarification';
    END IF;

    IF p_response NOT IN ('ACCEPTED', 'REPLIED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid response';
    END IF;

    UPDATE public.code_finder_proposals
    SET response = p_response,
        responded_by = p_user_id,
        responded_at = NOW()
    WHERE id = p_proposal_id;

    IF p_response IN ('ACCEPTED', 'REPLIED') THEN
        UPDATE public.code_finder_enquiries
        SET status = 'UNDER_REVIEW', updated_at = NOW()
        WHERE id = v_enquiry.id;
    ELSIF p_response = 'CANCELLED' THEN
        UPDATE public.code_finder_enquiries
        SET status = 'CANCELLED', updated_at = NOW()
        WHERE id = v_enquiry.id;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_to_proposal(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;


-- resolve_enquiry_items
CREATE OR REPLACE FUNCTION public.resolve_enquiry_items(p_enquiry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT jsonb_agg(
        jsonb_build_object(
            'enquiry_item_id', cei.id,
            'alternative_code_snapshot', cei.alternative_code_snapshot,
            'requested_quantity', cei.requested_quantity,
            'agreed_quantity', COALESCE(api.proposed_quantity, cei.requested_quantity),
            'product_id_snapshot', cei.product_id_snapshot,
            'current_product_id', lpc.product_id,
            'current_product_name', p.product_name,
            'current_stock', p.stock,
            'current_rate', p.rate_laminea,
            'current_calculation_type', p.calculation_type,
            'is_mapped', (lpc.product_id IS NOT NULL),
            'is_reassigned', (cei.product_id_snapshot IS NOT NULL AND lpc.product_id IS NOT NULL AND cei.product_id_snapshot <> lpc.product_id),
            'is_disabled', (lpc.id IS NOT NULL AND lpc.is_active = FALSE),
            'was_not_found', (cei.availability_status = 'CODE_NOT_FOUND')
        )
    ) INTO v_result
    FROM public.code_finder_enquiry_items cei
    LEFT JOIN public.laminea_product_codes lpc ON public.normalize_alternative_code(lpc.alternative_code) = public.normalize_alternative_code(cei.alternative_code_snapshot)
    LEFT JOIN public.products p ON p.id = lpc.product_id AND p.in_laminea = TRUE
    LEFT JOIN public.code_finder_proposals ap ON ap.enquiry_id=cei.enquiry_id
      AND ap.superseded_at IS NULL AND ap.proposal_type='QUANTITY_PROPOSAL' AND ap.response='ACCEPTED'
    LEFT JOIN public.code_finder_proposal_items api ON api.proposal_id=ap.id AND api.enquiry_item_id=cei.id
    WHERE cei.enquiry_id = p_enquiry_id;

    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_enquiry_items(UUID) FROM PUBLIC, anon;

-- create_estimate_from_enquiry
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

    IF v_enquiry.status <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Enquiry must be CONFIRMED before creating an estimate';
    END IF;

    IF p_platform IS DISTINCT FROM 'laminea' OR p_doc_type NOT IN ('ESTIMATE', 'QUOTATION') THEN
      RAISE EXCEPTION 'This operation creates Laminea estimates or quotations only';
    END IF;
    IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key required'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.code_finder_users u JOIN public.clients c ON c.id=u.laminea_client_id
      WHERE u.id=v_enquiry.code_finder_user_id AND c.id=p_client_id AND c.platform='laminea'
    ) THEN RAISE EXCEPTION 'Link the customer to the correct Laminea client first'; END IF;
    IF v_enquiry.converted_estimate_id IS NOT NULL THEN
      SELECT type INTO v_type FROM public.estimates WHERE id=v_enquiry.converted_estimate_id;
      IF v_type NOT IN ('ESTIMATE', 'QUOTATION') THEN
        RAISE EXCEPTION 'Existing linked document requires internal review; do not create another';
      END IF;
      RETURN jsonb_build_object('success',true,'estimate_id',v_enquiry.converted_estimate_id,'duplicate',true);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.code_finder_proposals
        WHERE enquiry_id = p_enquiry_id
          AND proposal_type = 'QUANTITY_PROPOSAL'
          AND superseded_at IS NULL AND response IS DISTINCT FROM 'ACCEPTED'
    ) INTO v_has_unresolved;

    IF v_has_unresolved THEN
        RAISE EXCEPTION 'Cannot convert enquiry with an unresolved quantity proposal.';
    END IF;

    -- Stabilize mapping and product eligibility until the stock RPC completes.
    PERFORM m.id FROM public.laminea_product_codes m
    JOIN public.code_finder_enquiry_items i ON
      public.normalize_alternative_code(i.alternative_code_snapshot)=public.normalize_alternative_code(m.alternative_code)
    WHERE i.enquiry_id=p_enquiry_id ORDER BY m.id FOR SHARE OF m;
    PERFORM p.id FROM public.products p
    WHERE p.id IN (
      SELECT m.product_id FROM public.laminea_product_codes m
      JOIN public.code_finder_enquiry_items i ON
       public.normalize_alternative_code(i.alternative_code_snapshot)=public.normalize_alternative_code(m.alternative_code)
      WHERE i.enquiry_id=p_enquiry_id)
    ORDER BY p.id FOR NO KEY UPDATE;
    v_resolved := public.resolve_enquiry_items(p_enquiry_id);
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR v_resolved IS NULL THEN
      RAISE EXCEPTION 'Estimate items required';
    END IF;
    IF jsonb_array_length(p_items) <> jsonb_array_length(v_resolved) THEN
      RAISE EXCEPTION 'Include every agreed enquiry item once';
    END IF;
    IF (SELECT count(DISTINCT x->>'enquiry_item_id') FROM jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) THEN
      RAISE EXCEPTION 'Duplicate or missing enquiry item IDs';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      SELECT x INTO v_expected FROM jsonb_array_elements(v_resolved) x
      WHERE x->>'enquiry_item_id'=v_item->>'enquiry_item_id';
      IF v_expected IS NULL OR v_expected->>'current_product_name' IS NULL
        OR (v_expected->>'is_disabled')::boolean
        OR (v_expected->>'is_reassigned')::boolean
        OR v_expected->>'product_id_snapshot' IS NULL
        OR (v_expected->>'was_not_found')::boolean THEN
        RAISE EXCEPTION 'Missing historical mapping or changed/ineligible code: resolve internally before conversion';
      END IF;
      IF v_item->>'product_id' IS DISTINCT FROM v_expected->>'current_product_id'
        OR public.normalize_alternative_code(v_item->>'alternative_code_snapshot') IS DISTINCT FROM
           public.normalize_alternative_code(v_expected->>'alternative_code_snapshot')
        OR v_item->>'calculation_type_snapshot' IS DISTINCT FROM v_expected->>'current_calculation_type'
        OR (CASE WHEN v_expected->>'current_calculation_type' IN ('SQFT','INCH','FEET')
             THEN (v_item->>'nos')::numeric ELSE (v_item->>'quantity')::numeric END)
           IS DISTINCT FROM (v_expected->>'agreed_quantity')::numeric THEN
        RAISE EXCEPTION 'Estimate item differs from the agreed enquiry';
      END IF;
      -- Preserve canonical code spelling for the existing stock RPC.
      SELECT jsonb_set(v_item,'{alternative_code_snapshot}',to_jsonb(alternative_code))
      INTO v_item FROM public.laminea_product_codes
      WHERE public.normalize_alternative_code(alternative_code)=
            public.normalize_alternative_code(v_expected->>'alternative_code_snapshot') AND is_active;
      IF v_item IS NULL THEN RAISE EXCEPTION 'Mapping unavailable'; END IF;
      v_normalized_items := v_normalized_items || jsonb_build_array(v_item);
    END LOOP;
    -- Existing RPC validates calculations and performs all stock movements.
    -- Caller-supplied prices remain editable by authorized staff as in the main editor.
    -- Call existing atomic function
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

    IF (v_est_result->>'success') IS DISTINCT FROM 'true' OR v_est_result->>'estimate_id' IS NULL THEN
      RAISE EXCEPTION 'Estimate save failed; transaction rolled back';
    END IF;
    v_est_id := (v_est_result->>'estimate_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.estimates WHERE id=v_est_id AND platform='laminea'
       AND client_id=p_client_id AND type='ESTIMATE') THEN
      RAISE EXCEPTION 'Unexpected estimate returned by existing RPC';
    END IF;
    IF EXISTS (SELECT 1 FROM public.code_finder_enquiries WHERE converted_estimate_id=v_est_id AND id<>p_enquiry_id) THEN
      RAISE EXCEPTION 'Estimate already linked to another enquiry';
    END IF;
    UPDATE public.code_finder_enquiries SET converted_estimate_id=v_est_id WHERE id=p_enquiry_id;
    RETURN v_est_result;
END;
$$;
REVOKE ALL ON FUNCTION public.create_estimate_from_enquiry(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, NUMERIC) FROM PUBLIC, anon;

-- Read tracking updates
CREATE OR REPLACE FUNCTION public.mark_enquiry_read(p_enquiry_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.cf8_require_staff();

    INSERT INTO public.code_finder_enquiry_reads (enquiry_id, staff_user_id, read_at)
    VALUES (p_enquiry_id, auth.uid(), NOW())
    ON CONFLICT (enquiry_id, staff_user_id) DO UPDATE SET read_at = NOW();
END;
$$;
REVOKE ALL ON FUNCTION public.mark_enquiry_read(UUID) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.update_message_read_cursor(p_cf_user_id UUID, p_message_created_at TIMESTAMPTZ, p_message_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.cf8_require_staff();

    IF NOT EXISTS (
        SELECT 1 FROM public.code_finder_messages 
        WHERE id = p_message_id AND code_finder_user_id = p_cf_user_id
    ) THEN
        RAISE EXCEPTION 'Invalid message reference';
    END IF;

    SELECT created_at INTO p_message_created_at FROM public.code_finder_messages WHERE id=p_message_id;
    INSERT INTO public.code_finder_message_reads (code_finder_user_id, staff_user_id, last_read_message_created_at, last_read_message_id, updated_at)
    VALUES (p_cf_user_id, auth.uid(), p_message_created_at, p_message_id, NOW())
    ON CONFLICT (code_finder_user_id, staff_user_id) DO UPDATE 
    SET last_read_message_created_at = p_message_created_at,
        last_read_message_id = p_message_id,
        updated_at = NOW()
    WHERE code_finder_message_reads.last_read_message_created_at IS NULL OR
      (code_finder_message_reads.last_read_message_created_at,code_finder_message_reads.last_read_message_id)
      < (EXCLUDED.last_read_message_created_at,EXCLUDED.last_read_message_id);
END;
$$;
REVOKE ALL ON FUNCTION public.update_message_read_cursor(UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;

-- 9. Notification Triggers

CREATE OR REPLACE FUNCTION public.notify_new_enquiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.notification_outbox (event_type, event_payload, notification_tag, next_retry_at)
    VALUES (
        'NEW_ENQUIRY', 
        jsonb_build_object('enquiry_id', NEW.id, 'user_id', NEW.code_finder_user_id),
        'enquiry:' || NEW.id,
        NOW()
    );
    RETURN NEW;
END;
$$;
CREATE TRIGGER trigger_notify_new_enquiry AFTER INSERT ON public.code_finder_enquiries FOR EACH ROW EXECUTE FUNCTION public.notify_new_enquiry();

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.sender_type = 'CLIENT' THEN
        INSERT INTO public.notification_outbox (event_type, event_payload, notification_tag, next_retry_at)
        VALUES (
            'NEW_MESSAGE', 
            jsonb_build_object('user_id', NEW.code_finder_user_id),
            'message:' || NEW.code_finder_user_id,
            NOW()
        );
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trigger_notify_new_message AFTER INSERT ON public.code_finder_messages FOR EACH ROW EXECUTE FUNCTION public.notify_new_message();

CREATE OR REPLACE FUNCTION public.notify_proposal_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.response IS NOT NULL AND OLD.response IS NULL THEN
        INSERT INTO public.notification_outbox (event_type, event_payload, notification_tag, next_retry_at)
        VALUES (
            'PROPOSAL_RESPONSE', 
            jsonb_build_object('enquiry_id', NEW.enquiry_id, 'proposal_id', NEW.id, 'response', NEW.response),
            'proposal:' || NEW.id,
            NOW()
        );
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trigger_notify_proposal_response AFTER UPDATE ON public.code_finder_proposals FOR EACH ROW EXECUTE FUNCTION public.notify_proposal_response();

-- 10. Explicit privileges: grants are additive, so revoke broad defaults first.
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_delivery_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_outbox, public.push_delivery_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_outbox, public.push_delivery_log TO service_role;
REVOKE ALL ON public.code_finder_proposals, public.code_finder_proposal_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.code_finder_proposals, public.code_finder_proposal_items TO authenticated;
GRANT ALL ON public.code_finder_proposals, public.code_finder_proposal_items TO service_role;
REVOKE ALL ON public.code_finder_enquiry_reads, public.code_finder_message_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.code_finder_enquiry_reads, public.code_finder_message_reads TO authenticated;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
 public.code_finder_enquiries, public.code_finder_enquiry_items, public.code_finder_users FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_enquiry_status(uuid,text,text),
 public.submit_proposal(uuid,text,text,jsonb), public.resolve_enquiry_items(uuid),
 public.mark_enquiry_read(uuid), public.update_message_read_cursor(uuid,timestamptz,uuid),
 public.create_estimate_from_enquiry(uuid,uuid,text,text,text,uuid,text,text,text,text,text,jsonb,jsonb,numeric)
 TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_proposal(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.notify_new_enquiry(),public.notify_new_message(),
 public.notify_proposal_response() FROM PUBLIC, anon, authenticated;

-- Capture new mapping snapshots inside the enquiry transaction. Historical rows
-- remain unknown; never backfill them with today's mapping and call it historical.
CREATE FUNCTION public.cf8_capture_mapping() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 NEW.product_id_snapshot := NULL;
 NEW.product_code_snapshot := NULL;
 NEW.mapping_revision_at := NULL;
 SELECT p.id,p.product_code,m.updated_at
 INTO NEW.product_id_snapshot,NEW.product_code_snapshot,NEW.mapping_revision_at
 FROM public.laminea_product_codes m JOIN public.products p ON p.id=m.product_id
 WHERE public.normalize_alternative_code(m.alternative_code)=
       public.normalize_alternative_code(NEW.alternative_code_snapshot)
   AND m.is_active AND p.in_laminea;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cf8_capture_mapping() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cf8_capture_mapping BEFORE INSERT ON public.code_finder_enquiry_items
FOR EACH ROW EXECUTE FUNCTION public.cf8_capture_mapping();

-- An actual persisted client message resolves clarification only. Quantity
-- proposals remain pending until the explicit acceptance endpoint is called.
CREATE FUNCTION public.cf8_clarification_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_proposal uuid;
BEGIN
 IF NEW.sender_type <> 'CLIENT' OR NEW.enquiry_id IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.code_finder_enquiries
 WHERE id=NEW.enquiry_id AND code_finder_user_id=NEW.code_finder_user_id
 AND status='AWAITING_CLIENT' FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT id INTO v_proposal FROM public.code_finder_proposals
 WHERE enquiry_id=NEW.enquiry_id AND proposal_type='CLARIFICATION'
 AND superseded_at IS NULL AND response IS NULL FOR UPDATE;
 IF FOUND THEN
  UPDATE public.code_finder_proposals SET response='REPLIED',responded_at=NOW(),
    responded_by=NEW.code_finder_user_id WHERE id=v_proposal;
  UPDATE public.code_finder_enquiries SET status='UNDER_REVIEW' WHERE id=NEW.enquiry_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cf8_clarification_reply() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cf8_clarification_reply AFTER INSERT ON public.code_finder_messages
FOR EACH ROW EXECUTE FUNCTION public.cf8_clarification_reply();

-- Lease token prevents an expired worker from acknowledging a newer worker's job.
ALTER TABLE public.notification_outbox ADD COLUMN lease_token uuid;
CREATE FUNCTION public.cf8_claim_push(p_limit integer DEFAULT 20)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
 RETURN QUERY
 WITH candidates AS (
 SELECT id FROM public.notification_outbox
 WHERE processed_at IS NULL AND retry_count<max_retries
 AND COALESCE(next_retry_at,created_at)<=NOW()
 AND (processing_lease_until IS NULL OR processing_lease_until<NOW())
 ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit
 )
 UPDATE public.notification_outbox o SET processing_lease_until=NOW()+interval '2 minutes',
 lease_token=gen_random_uuid(), retry_count=retry_count+1
 FROM candidates c WHERE o.id=c.id RETURNING o.*;
END $$;
REVOKE ALL ON FUNCTION public.cf8_claim_push(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cf8_claim_push(integer) TO service_role;

-- Staff message retries: frontend supplies a stable UUID for each send attempt.
ALTER TABLE public.code_finder_messages ADD COLUMN IF NOT EXISTS client_message_key uuid;
CREATE UNIQUE INDEX cf8_staff_message_retry
ON public.code_finder_messages(sender_auth_user_id,client_message_key)
WHERE sender_type='STAFF' AND client_message_key IS NOT NULL;

COMMIT;
