BEGIN;

CREATE OR REPLACE FUNCTION public.check_laminea_stock_availability(
    p_requests JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_count INTEGER;
    v_result JSONB;
BEGIN
    ---------------------------------------------------------------------------
    -- Validate request structure
    ---------------------------------------------------------------------------

    IF p_requests IS NULL
       OR jsonb_typeof(p_requests) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Requests must be provided as a JSON array';
    END IF;

    v_request_count := jsonb_array_length(p_requests);

    IF v_request_count = 0 THEN
        RAISE EXCEPTION 'At least one request is required';
    END IF;

    IF v_request_count > 25 THEN
        RAISE EXCEPTION 'Maximum 25 codes are allowed per request';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_requests) AS request(value)
        WHERE jsonb_typeof(request.value) IS DISTINCT FROM 'object'
    ) THEN
        RAISE EXCEPTION 'Every request must be a JSON object';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_requests) AS request(value)
        WHERE LENGTH(COALESCE(request.value ->> 'code', '')) > 100
    ) THEN
        RAISE EXCEPTION 'Alternative code cannot exceed 100 characters';
    END IF;

    ---------------------------------------------------------------------------
    -- Normalize, aggregate, resolve mapping and calculate availability
    ---------------------------------------------------------------------------

    WITH input_rows AS (
        SELECT
            request.ordinality::INTEGER AS input_order,
            NULLIF(TRIM(request.value ->> 'code'), '') AS display_code,

            public.normalize_alternative_code(
                request.value ->> 'code'
            ) AS normalized_code,

            CASE
                WHEN request.value ->> 'quantity'
                     ~ '^[+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$'
                THEN (request.value ->> 'quantity')::NUMERIC
                ELSE NULL
            END AS requested_quantity
        FROM jsonb_array_elements(p_requests)
             WITH ORDINALITY AS request(value, ordinality)
    ),

    aggregated AS (
        SELECT
            normalized_code,

            (
                ARRAY_AGG(
                    UPPER(display_code)
                    ORDER BY input_order
                )
            )[1] AS display_code,

            MIN(input_order) AS first_input_order,

            BOOL_OR(
                requested_quantity IS NULL
                OR requested_quantity <= 0
                OR requested_quantity = 'NaN'::NUMERIC
            ) AS has_invalid_quantity,

            SUM(
                requested_quantity
            ) FILTER (
                WHERE requested_quantity IS NOT NULL
                  AND requested_quantity > 0
                  AND requested_quantity <> 'NaN'::NUMERIC
            ) AS total_quantity

        FROM input_rows
        WHERE normalized_code IS NOT NULL
          AND normalized_code <> ''
        GROUP BY normalized_code
    ),

    resolved AS (
        SELECT
            aggregated.normalized_code,
            aggregated.display_code,
            aggregated.first_input_order,
            aggregated.has_invalid_quantity,
            aggregated.total_quantity,

            mapping.product_id,
            product.stock

        FROM aggregated

        LEFT JOIN public.laminea_product_codes AS mapping
          ON mapping.is_active IS TRUE
         AND public.normalize_alternative_code(
                 mapping.alternative_code
             ) = aggregated.normalized_code

        LEFT JOIN public.products AS product
          ON product.id = mapping.product_id
    )

    SELECT COALESCE(
        JSONB_AGG(
            CASE
                WHEN has_invalid_quantity THEN
                    JSONB_BUILD_OBJECT(
                        'code',
                        COALESCE(display_code, normalized_code),

                        'requestedQuantity',
                        'Invalid',

                        'status',
                        'INVALID QUANTITY'
                    )

                WHEN product_id IS NULL THEN
                    JSONB_BUILD_OBJECT(
                        'code',
                        COALESCE(display_code, normalized_code),

                        'requestedQuantity',
                        total_quantity,

                        'status',
                        'CODE NOT FOUND'
                    )

                ELSE
                    JSONB_BUILD_OBJECT(
                        'code',
                        COALESCE(display_code, normalized_code),

                        'requestedQuantity',
                        total_quantity,

                        'status',
                        CASE
                            -- This preserves your current maximum-10 rule.
                            WHEN total_quantity BETWEEN 1 AND 10
                             AND COALESCE(stock, 0) >= total_quantity
                                THEN 'AVAILABLE'
                            ELSE 'PLEASE CONFIRM WITH US'
                        END
                    )
            END
            ORDER BY first_input_order
        ),
        '[]'::JSONB
    )
    INTO v_result
    FROM resolved;

    IF v_result = '[]'::JSONB THEN
        RAISE EXCEPTION 'No valid alternative codes were provided';
    END IF;

    RETURN v_result;
END;
$$;

REVOKE ALL
ON FUNCTION public.check_laminea_stock_availability(JSONB)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.check_laminea_stock_availability(JSONB)
TO service_role;

COMMIT;
