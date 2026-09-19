-- =============================================================================
-- File: 10_code_finder_hardening.sql
--
-- Phase 3: Atomic enquiry creation with idempotency
-- Phase 4: Normalized username
-- Phase 5: Persistent namespaced rate limiting
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. NORMALIZED USERNAME
-- =============================================================================

ALTER TABLE public.code_finder_users
ADD COLUMN IF NOT EXISTS normalized_username TEXT
GENERATED ALWAYS AS (
    UPPER(
        REGEXP_REPLACE(
            TRIM(username),
            '\s+',
            '',
            'g'
        )
    )
) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS
code_finder_users_normalized_username_idx
ON public.code_finder_users(normalized_username);

-- The new generated-column index replaces the old expression index.
DROP INDEX IF EXISTS public.code_finder_users_username_unique;


-- =============================================================================
-- 2. ENQUIRY IDEMPOTENCY
-- =============================================================================

ALTER TABLE public.code_finder_enquiries
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS
code_finder_enquiries_idempotency_idx
ON public.code_finder_enquiries(
    code_finder_user_id,
    idempotency_key
)
WHERE idempotency_key IS NOT NULL;


-- =============================================================================
-- 3. ATOMIC ENQUIRY CREATION
--
-- p_user_id must be public.code_finder_users.id,
-- not auth.users.id.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_code_finder_enquiry(
    p_user_id UUID,
    p_items JSONB,
    p_client_note TEXT DEFAULT NULL,
    p_checked_at TIMESTAMPTZ DEFAULT NOW(),
    p_idempotency_key TEXT DEFAULT NULL
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
        idempotency_key
    )
    VALUES (
        p_user_id,
        'NEW',
        NULLIF(TRIM(p_client_note), ''),
        v_checked_at,
        v_idempotency_key
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
    TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_code_finder_enquiry(
    UUID,
    JSONB,
    TEXT,
    TIMESTAMPTZ,
    TEXT
) TO service_role;


-- =============================================================================
-- 4. PERSISTENT NAMESPACED RATE LIMITING
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.code_finder_rate_limits (
    namespace TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_seconds INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT code_finder_rate_limits_pkey
        PRIMARY KEY (namespace, key_hash)
);

-- Supports rerunning after an earlier version of this migration.

ALTER TABLE public.code_finder_rate_limits
ADD COLUMN IF NOT EXISTS window_seconds INTEGER NOT NULL DEFAULT 60;

ALTER TABLE public.code_finder_rate_limits
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.code_finder_rate_limits
FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- 5. ATOMIC RATE-LIMIT RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_rate_limit_v2(
    p_namespace TEXT,
    p_key_hash TEXT,
    p_max_requests INTEGER DEFAULT 10,
    p_window_seconds INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_namespace TEXT;
    v_key_hash TEXT;

    v_now TIMESTAMPTZ := NOW();
    v_window INTERVAL;

    v_request_count INTEGER;
    v_window_start TIMESTAMPTZ;
    v_allowed BOOLEAN;
    v_remaining INTEGER;
    v_retry_after INTEGER;
BEGIN
    v_namespace := LOWER(NULLIF(TRIM(p_namespace), ''));
    v_key_hash := LOWER(NULLIF(TRIM(p_key_hash), ''));

    IF v_namespace IS NULL
       OR LENGTH(v_namespace) NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'Invalid rate-limit namespace.';
    END IF;

    IF v_key_hash IS NULL
       OR LENGTH(v_key_hash) NOT BETWEEN 32 AND 128 THEN
        RAISE EXCEPTION 'Invalid rate-limit key hash.';
    END IF;

    IF p_max_requests IS NULL
       OR p_max_requests NOT BETWEEN 1 AND 10000 THEN
        RAISE EXCEPTION 'Invalid maximum request limit.';
    END IF;

    IF p_window_seconds IS NULL
       OR p_window_seconds NOT BETWEEN 1 AND 86400 THEN
        RAISE EXCEPTION 'Invalid rate-limit window.';
    END IF;

    v_window := make_interval(secs => p_window_seconds);


    ---------------------------------------------------------------------------
    -- One atomic UPSERT prevents concurrent requests from losing increments.
    ---------------------------------------------------------------------------

    INSERT INTO public.code_finder_rate_limits AS existing_limit (
        namespace,
        key_hash,
        request_count,
        window_start,
        window_seconds
    )
    VALUES (
        v_namespace,
        v_key_hash,
        1,
        v_now,
        p_window_seconds
    )
    ON CONFLICT (namespace, key_hash)
    DO UPDATE
    SET
        request_count =
            CASE
                WHEN existing_limit.window_start <= v_now - v_window
                    THEN 1
                ELSE existing_limit.request_count + 1
            END,

        window_start =
            CASE
                WHEN existing_limit.window_start <= v_now - v_window
                    THEN v_now
                ELSE existing_limit.window_start
            END,

        window_seconds = p_window_seconds
    RETURNING request_count, window_start
    INTO v_request_count, v_window_start;


    v_allowed := v_request_count <= p_max_requests;

    v_remaining := GREATEST(
        p_max_requests - v_request_count,
        0
    );

    IF v_allowed THEN
        v_retry_after := 0;
    ELSE
        v_retry_after := GREATEST(
            CEIL(
                EXTRACT(
                    EPOCH FROM (
                        (v_window_start + v_window) - v_now
                    )
                )
            )::INTEGER,
            0
        );
    END IF;


    RETURN jsonb_build_object(
        'allowed', v_allowed,
        'remaining', v_remaining,
        'retry_after_seconds', v_retry_after,
        'reset_at', v_window_start + v_window
    );
END;
$$;


REVOKE ALL ON FUNCTION public.check_rate_limit_v2(
    TEXT,
    TEXT,
    INTEGER,
    INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_rate_limit_v2(
    TEXT,
    TEXT,
    INTEGER,
    INTEGER
) TO service_role;


-- =============================================================================
-- 6. RATE-LIMIT CLEANUP FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_rate_limits(
    p_grace_minutes INTEGER DEFAULT 10
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    IF p_grace_minutes IS NULL
       OR p_grace_minutes NOT BETWEEN 1 AND 10080 THEN
        RAISE EXCEPTION 'Invalid cleanup grace period.';
    END IF;

    DELETE FROM public.code_finder_rate_limits
    WHERE
        window_start
        + make_interval(secs => window_seconds)
        < NOW() - make_interval(mins => p_grace_minutes);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    RETURN v_deleted;
END;
$$;


REVOKE ALL ON FUNCTION public.cleanup_rate_limits(INTEGER)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits(INTEGER)
TO service_role;


COMMIT;
