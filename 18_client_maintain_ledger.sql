BEGIN;

ALTER TABLE public.clients
ADD COLUMN maintain_ledger BOOLEAN NOT NULL DEFAULT true;

-- Update the RPC to accept opening_balance and maintain_ledger
CREATE OR REPLACE FUNCTION public.create_and_link_laminea_client(
    p_cf_user_id UUID,
    p_client_name TEXT,
    p_mobile TEXT DEFAULT NULL,
    p_contact_person TEXT DEFAULT NULL,
    p_opening_balance NUMERIC DEFAULT 0,
    p_maintain_ledger BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_client_id UUID;
    v_normalized_name TEXT;
    v_normalized_mobile TEXT;
    v_client JSONB;
BEGIN
    PERFORM public.cf8_require_staff();

    IF p_client_name IS NULL OR TRIM(p_client_name) = '' THEN
        RAISE EXCEPTION 'Client name is required';
    END IF;

    -- Lock the Code Finder user
    PERFORM 1
    FROM public.code_finder_users
    WHERE id = p_cf_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Code Finder user not found';
    END IF;

    v_normalized_name :=
        UPPER(REGEXP_REPLACE(TRIM(p_client_name), '\s+', ' ', 'g'));

    v_normalized_mobile :=
        NULLIF(REGEXP_REPLACE(COALESCE(p_mobile, ''), '\s+', '', 'g'), '');

    -- Prevent two simultaneous requests from creating duplicates
    PERFORM pg_advisory_xact_lock(
        hashtext(
            'code-finder-client:' ||
            v_normalized_name || ':' ||
            COALESCE(v_normalized_mobile, '')
        )
    );

    IF EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.platform = 'laminea'
          AND UPPER(REGEXP_REPLACE(TRIM(c.name), '\s+', ' ', 'g'))
              = v_normalized_name
          AND COALESCE(
                REGEXP_REPLACE(COALESCE(c.mobile, ''), '\s+', '', 'g'),
                ''
              ) = COALESCE(v_normalized_mobile, '')
    ) THEN
        RAISE EXCEPTION
            'A matching Laminea client already exists. Link the existing client instead.';
    END IF;

    INSERT INTO public.clients (
        name,
        company_name,
        owner_name,
        mobile,
        platform,
        opening_balance,
        maintain_ledger
    )
    VALUES (
        v_normalized_name,
        v_normalized_name,
        NULLIF(UPPER(TRIM(p_contact_person)), ''),
        v_normalized_mobile,
        'laminea',
        p_opening_balance,
        p_maintain_ledger
    )
    RETURNING id INTO v_client_id;

    UPDATE public.code_finder_users
    SET laminea_client_id = v_client_id,
        updated_at = NOW()
    WHERE id = p_cf_user_id;

    SELECT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'mobile', c.mobile,
        'company_name', c.company_name,
        'owner_name', c.owner_name,
        'platform', c.platform,
        'maintain_ledger', c.maintain_ledger
    )
    INTO v_client
    FROM public.clients c
    WHERE c.id = v_client_id;

    RETURN v_client;
END;
$$;

COMMIT;
