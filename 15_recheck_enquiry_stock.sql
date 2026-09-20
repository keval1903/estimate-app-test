BEGIN;

CREATE OR REPLACE FUNCTION public.recheck_enquiry_stock(
    p_enquiry_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.cf8_require_staff();

    IF NOT EXISTS (
        SELECT 1
        FROM public.code_finder_enquiries
        WHERE id = p_enquiry_id
    ) THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    WITH resolved AS (
        SELECT
            cei.id AS enquiry_item_id,
            lpc.product_id,
            lpc.is_active,
            p.id AS eligible_product_id,
            p.stock
        FROM public.code_finder_enquiry_items cei
        LEFT JOIN public.laminea_product_codes lpc
          ON public.normalize_alternative_code(lpc.alternative_code)
           = public.normalize_alternative_code(
               cei.alternative_code_snapshot
             )
        LEFT JOIN public.products p
          ON p.id = lpc.product_id
         AND p.in_laminea IS TRUE
         AND p.has_stock IS TRUE
        WHERE cei.enquiry_id = p_enquiry_id
    )
    UPDATE public.code_finder_enquiry_items cei
    SET
        availability_status = CASE
            WHEN resolved.product_id IS NULL
              OR resolved.is_active IS DISTINCT FROM TRUE
              OR resolved.eligible_product_id IS NULL
                THEN 'CODE_NOT_FOUND'

            WHEN cei.requested_quantity > 10
                THEN 'PLEASE_CONFIRM'

            WHEN COALESCE(resolved.stock, 0)
                 >= cei.requested_quantity
                THEN 'AVAILABLE'

            ELSE 'PLEASE_CONFIRM'
        END,
        checked_at = NOW()
    FROM resolved
    WHERE cei.id = resolved.enquiry_item_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.recheck_enquiry_stock(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.recheck_enquiry_stock(UUID)
TO authenticated;


-- Update resolve_enquiry_items to return missing columns
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
            'current_product_code', p.product_code,
            'current_length', p.length,
            'current_width', p.width,
            'current_unit', p.unit,
            'current_has_stock', p.has_stock,
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

COMMIT;
