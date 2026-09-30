BEGIN;

ALTER TABLE public.code_finder_enquiries
ADD COLUMN IF NOT EXISTS ordered_by TEXT;

ALTER TABLE public.code_finder_enquiries
DROP CONSTRAINT IF EXISTS code_finder_enquiries_ordered_by_check;

ALTER TABLE public.code_finder_enquiries
ADD CONSTRAINT code_finder_enquiries_ordered_by_check
CHECK (
    ordered_by IS NULL
    OR LENGTH(TRIM(ordered_by)) BETWEEN 1 AND 100
);

CREATE UNIQUE INDEX IF NOT EXISTS code_finder_enquiries_idempotency_idx
ON public.code_finder_enquiries (
    code_finder_user_id,
    idempotency_key
)
WHERE idempotency_key IS NOT NULL;

--
-- p_user_id must be public.code_finder_users.id,
-- not auth.users.id.
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_code_finder_enquiry(
    UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT
);

CREATE OR REPLACE FUNCTION public.create_code_finder_enquiry(
    p_user_id UUID,
    p_items JSONB,
    p_client_note TEXT DEFAULT NULL,
    p_checked_at TIMESTAMPTZ DEFAULT NOW(),
    p_idempotency_key TEXT DEFAULT NULL,
    p_ordered_by TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enquiry_id UUID;
    v_enquiry_number BIGINT;
    v_existing RECORD;
    v_item JSONB;

    v_code TEXT;
    v_status TEXT;
    v_quantity NUMERIC(12,2);

    v_checked_at TIMESTAMPTZ;
    v_idempotency_key TEXT;
BEGIN
    ---------------------------------------------------------------------------
    -- Validate Code Finder user
    ---------------------------------------------------------------------------

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Code Finder user ID is required.';
    END IF;

    PERFORM 1
    FROM public.code_finder_users
    WHERE id = p_user_id
      AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Code Finder user is inactive or does not exist.';
    END IF;


    ---------------------------------------------------------------------------
    -- Validate idempotency key
    ---------------------------------------------------------------------------

    v_idempotency_key := NULLIF(TRIM(p_idempotency_key), '');

    IF v_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required.';
    END IF;

    IF LENGTH(v_idempotency_key) NOT BETWEEN 8 AND 100 THEN
        RAISE EXCEPTION 'Idempotency key must contain between 8 and 100 characters.';
    END IF;


    ---------------------------------------------------------------------------
    -- Validate enquiry
    ---------------------------------------------------------------------------

    IF p_client_note IS NOT NULL
       AND LENGTH(p_client_note) > 2000 THEN
        RAISE EXCEPTION 'Client note cannot exceed 2000 characters.';
    END IF;

    IF p_ordered_by IS NOT NULL
       AND LENGTH(TRIM(p_ordered_by)) > 100 THEN
        RAISE EXCEPTION 'Ordered by cannot exceed 100 characters.';
    END IF;

    IF p_items IS NULL
       OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Items must be provided as a JSON array.';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'At least one enquiry item is required.';
    END IF;

    IF jsonb_array_length(p_items) > 25 THEN
        RAISE EXCEPTION 'Maximum 25 items are allowed per enquiry.';
    END IF;

    v_checked_at := COALESCE(p_checked_at, NOW());


    ---------------------------------------------------------------------------
    -- Validate every item before creating the enquiry
    ---------------------------------------------------------------------------

    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_items)
    LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Every enquiry item must be a JSON object.';
        END IF;

        v_code := NULLIF(
            TRIM(v_item ->> 'alternative_code_snapshot'),
            ''
        );

        IF v_code IS NULL THEN
            RAISE EXCEPTION 'Alternative code is required for every item.';
        END IF;

        IF LENGTH(v_code) > 100 THEN
            RAISE EXCEPTION 'Alternative code cannot exceed 100 characters.';
        END IF;

        BEGIN
            v_quantity :=
                (v_item ->> 'requested_quantity')::NUMERIC(12,2);
        EXCEPTION
            WHEN invalid_text_representation
              OR numeric_value_out_of_range THEN
                RAISE EXCEPTION
                    'Invalid requested quantity for alternative code %.',
                    v_code;
        END;

        IF v_quantity IS NULL OR v_quantity <= 0 THEN
            RAISE EXCEPTION
                'Requested quantity must be greater than zero for alternative code %.',
                v_code;
        END IF;

        v_status := v_item ->> 'availability_status';

        IF v_status IS NULL
           OR v_status NOT IN (
               'AVAILABLE',
               'PLEASE_CONFIRM',
               'CODE_NOT_FOUND'
           ) THEN
            RAISE EXCEPTION
                'Invalid availability status for alternative code %.',
                v_code;
        END IF;
    END LOOP;


    ---------------------------------------------------------------------------
    -- Prevent duplicate normalized codes inside the same enquiry payload
    ---------------------------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS item(value)
        GROUP BY UPPER(
            REGEXP_REPLACE(
                TRIM(item.value ->> 'alternative_code_snapshot'),
                '\s+',
                '',
                'g'
            )
        )
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate alternative codes were found in the enquiry.';
    END IF;


    ---------------------------------------------------------------------------
    -- Insert enquiry atomically.
    --
    -- ON CONFLICT makes concurrent retries safe. Only one enquiry is created.
    ---------------------------------------------------------------------------

    INSERT INTO public.code_finder_enquiries (
        code_finder_user_id,
        status,
        client_note,
        checked_at,
        idempotency_key,
        ordered_by
    )
    VALUES (
        p_user_id,
        'NEW',
        NULLIF(TRIM(p_client_note), ''),
        v_checked_at,
        v_idempotency_key,
        NULLIF(TRIM(p_ordered_by), '')
    )
    ON CONFLICT (
        code_finder_user_id,
        idempotency_key
    )
    WHERE idempotency_key IS NOT NULL
    DO NOTHING
    RETURNING id, enquiry_number
    INTO v_enquiry_id, v_enquiry_number;


    ---------------------------------------------------------------------------
    -- Existing request with the same idempotency key
    ---------------------------------------------------------------------------

    IF v_enquiry_id IS NULL THEN
        SELECT id, enquiry_number
        INTO v_existing
        FROM public.code_finder_enquiries
        WHERE code_finder_user_id = p_user_id
          AND idempotency_key = v_idempotency_key;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Unable to resolve the existing idempotent enquiry.';
        END IF;

        RETURN jsonb_build_object(
            'success', TRUE,
            'enquiry_id', v_existing.id,
            'enquiry_number', v_existing.enquiry_number,
            'duplicate', TRUE
        );
    END IF;


    ---------------------------------------------------------------------------
    -- Insert all enquiry items
    ---------------------------------------------------------------------------

    INSERT INTO public.code_finder_enquiry_items (
        enquiry_id,
        alternative_code_snapshot,
        requested_quantity,
        availability_status,
        checked_at
    )
    SELECT
        v_enquiry_id,
        TRIM(item.value ->> 'alternative_code_snapshot'),
        (item.value ->> 'requested_quantity')::NUMERIC(12,2),
        item.value ->> 'availability_status',
        v_checked_at
    FROM jsonb_array_elements(p_items) AS item(value);


    RETURN jsonb_build_object(
        'success', TRUE,
        'enquiry_id', v_enquiry_id,
        'enquiry_number', v_enquiry_number,
        'duplicate', FALSE
    );
END;
$$;


-- The RPC can only be called using the service-role key.

REVOKE ALL ON FUNCTION public.create_code_finder_enquiry(
    UUID,
    JSONB,
    TEXT,
    TIMESTAMPTZ,
    TEXT,
    TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_code_finder_enquiry(
    UUID,
    JSONB,
    TEXT,
    TIMESTAMPTZ,
    TEXT,
    TEXT
) TO service_role;

COMMIT;
