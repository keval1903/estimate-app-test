BEGIN;

-- Remove the stored stock snapshot if the previous script added it.
-- Live stock must always come directly from products.
ALTER TABLE public.code_finder_enquiry_items
DROP COLUMN IF EXISTS live_stock_snapshot;


-- ============================================================
-- 1. Recheck enquiry availability using live database stock
-- ============================================================

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
            p.has_stock,
            p.stock,

            -- Use the latest accepted proposed quantity.
            -- Fall back to the originally requested quantity.
            COALESCE(
                accepted_item.proposed_quantity,
                cei.requested_quantity
            ) AS effective_quantity

        FROM public.code_finder_enquiry_items cei

        LEFT JOIN public.laminea_product_codes lpc
          ON public.normalize_alternative_code(
                 lpc.alternative_code
             ) = public.normalize_alternative_code(
                 cei.alternative_code_snapshot
             )

        LEFT JOIN public.products p
          ON p.id = lpc.product_id
         AND p.in_laminea IS TRUE

        LEFT JOIN LATERAL (
            SELECT cpi.proposed_quantity
            FROM public.code_finder_proposals cp
            JOIN public.code_finder_proposal_items cpi
              ON cpi.proposal_id = cp.id
            WHERE cp.enquiry_id = cei.enquiry_id
              AND cpi.enquiry_item_id = cei.id
              AND cp.proposal_type = 'QUANTITY_PROPOSAL'
              AND cp.response = 'ACCEPTED'
              AND cp.superseded_at IS NULL
            ORDER BY cp.revision DESC, cp.submitted_at DESC
            LIMIT 1
        ) accepted_item ON TRUE

        WHERE cei.enquiry_id = p_enquiry_id
    )

    UPDATE public.code_finder_enquiry_items cei
    SET
        availability_status = CASE
            -- Missing, inactive, or non-Laminea product
            WHEN resolved.product_id IS NULL
              OR resolved.is_active IS DISTINCT FROM TRUE
              OR resolved.eligible_product_id IS NULL
                THEN 'CODE_NOT_FOUND'

            -- Non-stock Laminea products remain valid but require confirmation
            WHEN resolved.has_stock IS DISTINCT FROM TRUE
                THEN 'PLEASE_CONFIRM'

            -- Quantities above 10 always require confirmation
            WHEN resolved.effective_quantity > 10
                THEN 'PLEASE_CONFIRM'

            -- Stock-managed product with sufficient live stock
            WHEN COALESCE(resolved.stock, 0)
                 >= resolved.effective_quantity
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


-- ============================================================
-- 2. Return live product details to staff
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_enquiry_items(
    p_enquiry_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
BEGIN
    PERFORM public.cf8_require_staff();

    IF NOT EXISTS (
        SELECT 1
        FROM public.code_finder_enquiries
        WHERE id = p_enquiry_id
    ) THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'enquiry_item_id',
                    cei.id,

                'alternative_code_snapshot',
                    cei.alternative_code_snapshot,

                'requested_quantity',
                    cei.requested_quantity,

                'agreed_quantity',
                    COALESCE(
                        accepted_item.proposed_quantity,
                        cei.requested_quantity
                    ),

                'product_id_snapshot',
                    cei.product_id_snapshot,

                'current_product_id',
                    lpc.product_id,

                'current_product_name',
                    p.product_name,

                'current_product_code',
                    p.product_code,

                'current_length',
                    p.length,

                'current_width',
                    p.width,

                'current_unit',
                    p.unit,

                'current_has_stock',
                    p.has_stock,

                -- Current live stock from Product Master
                'current_stock',
                    p.stock,

                'current_rate',
                    p.rate_laminea,

                'current_calculation_type',
                    p.calculation_type,

                'is_mapped',
                    (
                        lpc.product_id IS NOT NULL
                        AND p.id IS NOT NULL
                    ),

                'is_reassigned',
                    (
                        cei.product_id_snapshot IS NOT NULL
                        AND lpc.product_id IS NOT NULL
                        AND cei.product_id_snapshot <> lpc.product_id
                    ),

                'is_disabled',
                    (
                        lpc.id IS NOT NULL
                        AND lpc.is_active IS FALSE
                    ),

                'was_not_found',
                    cei.availability_status = 'CODE_NOT_FOUND'
            )
            ORDER BY cei.created_at
        ),
        '[]'::JSONB
    )
    INTO v_result

    FROM public.code_finder_enquiry_items cei

    LEFT JOIN public.laminea_product_codes lpc
      ON public.normalize_alternative_code(
             lpc.alternative_code
         ) = public.normalize_alternative_code(
             cei.alternative_code_snapshot
         )

    LEFT JOIN public.products p
      ON p.id = lpc.product_id
     AND p.in_laminea IS TRUE

    LEFT JOIN LATERAL (
        SELECT cpi.proposed_quantity
        FROM public.code_finder_proposals cp
        JOIN public.code_finder_proposal_items cpi
          ON cpi.proposal_id = cp.id
        WHERE cp.enquiry_id = cei.enquiry_id
          AND cpi.enquiry_item_id = cei.id
          AND cp.proposal_type = 'QUANTITY_PROPOSAL'
          AND cp.response = 'ACCEPTED'
          AND cp.superseded_at IS NULL
        ORDER BY cp.revision DESC, cp.submitted_at DESC
        LIMIT 1
    ) accepted_item ON TRUE

    WHERE cei.enquiry_id = p_enquiry_id;

    RETURN v_result;
END;
$$;

REVOKE ALL
ON FUNCTION public.resolve_enquiry_items(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.resolve_enquiry_items(UUID)
TO authenticated;

COMMIT;
